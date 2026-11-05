//! Debugger for .NET projects: netcoredbg (Samsung, MIT) speaks DAP over stdio with the same Content-Length framing
//! as a language server, so lsp.rs runs it as the server "netcoredbg" and the DAP client lives in src/lib/debug.svelte.ts.
//! Here: fetching netcoredbg (pinned release, checked sha256) and building the project to get the dll to launch.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use sha2::{Digest, Sha256};

const BASE: &str = "https://github.com/Samsung/netcoredbg/releases/download/";

/// Release asset for this platform and its sha256 from the GitHub release. 3.2.0 dropped the Intel Mac build.
fn asset() -> Option<(&'static str, &'static str)> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => ("3.2.0-1092/netcoredbg-osx-arm64.zip", "f4fa33b3ff874910cc184b4bb3b9c56d0abdf5c6521cee0b144d7c6e4a6e59ea"),
        ("macos", "x86_64") => ("3.1.3-1062/netcoredbg-osx-amd64.tar.gz", "49459b066836b6a452f418501d7ecab57bcd7e60d8464faac21ff70b496b8634"),
        ("linux", "x86_64") => ("3.2.0-1092/netcoredbg-linux-amd64.tar.gz", "080eb3b2d2152465f599d3b33d1ee6e747794e11cc0a3773ec689f5e5f2c5afa"),
        ("linux", "aarch64") => ("3.2.0-1092/netcoredbg-linux-arm64.tar.gz", "065ff49badec8a695dbea2de6ab6a330c774a191e426a217ab8cc05250627ccb"),
        ("windows", "x86_64") => ("3.2.0-1092/netcoredbg-win64.zip", "3c410a45fa502415203a94fcb88654af65bf8e3dac158a5527a722e7a6b9274a"),
        _ => return None,
    })
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Download and unpack netcoredbg into own/netcoredbg (own = the language servers' folder, where lsp.rs looks).
pub(crate) fn fetch(own: &Path) -> Result<(), String> {
    let (path, sum) = asset().ok_or("netcoredbg gibt es für diese Plattform nicht")?;
    let fail = |e: String| format!("netcoredbg herunterladen: {e}");
    let url = format!("{BASE}{path}");
    let bytes = tauri::async_runtime::block_on(async {
        let c = reqwest::Client::builder().timeout(std::time::Duration::from_secs(300)).build().map_err(|e| e.to_string())?;
        let r = c.get(&url).send().await.and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?;
        r.bytes().await.map_err(|e| e.to_string())
    })
    .map_err(fail)?;
    let got = hex(&Sha256::digest(&bytes));
    if got != sum {
        return Err(fail(format!("Prüfsumme stimmt nicht ({got})")));
    }
    std::fs::create_dir_all(own).map_err(|e| fail(e.to_string()))?;
    let file = own.join(path.rsplit('/').next().unwrap_or("netcoredbg.zip"));
    std::fs::write(&file, &bytes).map_err(|e| fail(e.to_string()))?;
    // bsdtar (macOS, Windows 10+) unpacks zip as well; Linux only gets tar.gz.
    let out = crate::quiet("tar").arg("-xf").arg(&file).arg("-C").arg(own).stdin(Stdio::null()).output();
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::remove_dir_all(own.join("__MACOSX"));
    match out {
        Ok(o) if o.status.success() => {}
        Ok(o) => return Err(fail(format!("Entpacken: {}", String::from_utf8_lossy(&o.stderr).trim()))),
        Err(e) => return Err(fail(format!("tar: {e}"))),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(own.join("netcoredbg").join("netcoredbg"), std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

/// Build the one project in the folder (Debug) and return its dll; Err carries the compiler errors.
#[tauri::command]
pub async fn dbg_build(repo: String, dir: String) -> Result<String, String> {
    let cwd = if dir.is_empty() { PathBuf::from(&repo) } else { crate::files::within(&repo, &dir)? };
    crate::git::blocking(move || {
        let o = crate::quiet(&crate::runner::sdk("dotnet"))
            .args(["build", "-nologo", "-c", "Debug", "-getProperty:TargetPath", "-getTargetResult:Build"])
            .current_dir(&cwd)
            .env("DOTNET_CLI_UI_LANGUAGE", "en")
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("dotnet nicht gestartet: {e}"))?;
        built(&String::from_utf8_lossy(&o.stdout), &String::from_utf8_lossy(&o.stderr))
    })
    .await
}

/// With -getTargetResult, dotnet prints a JSON summary after the build's own lines; errors go before it.
fn built(out: &str, err: &str) -> Result<String, String> {
    let json = out.find("\n{").map(|i| &out[i + 1..]).or(out.starts_with('{').then_some(out));
    let v: serde_json::Value = json.and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default();
    let path = v["Properties"]["TargetPath"].as_str().unwrap_or_default();
    if v["TargetResults"]["Build"]["Result"] == "Success" && !path.is_empty() {
        return Ok(path.to_string());
    }
    let mut errors: Vec<&str> = Vec::new();
    for l in out.lines().chain(err.lines()).map(str::trim) {
        if (l.contains(": error ") || l.starts_with("MSBUILD : error")) && !errors.contains(&l) {
            errors.push(l);
        }
    }
    let shown = if errors.is_empty() { out.lines().chain(err.lines()).filter(|l| !l.trim().is_empty()).take(8).collect() } else { errors[..errors.len().min(8)].to_vec() };
    Err(format!("Build fehlgeschlagen:\n{}", shown.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_ergebnis() {
        let ok = "{\n  \"Properties\": { \"TargetPath\": \"/p/bin/Debug/net9.0/Lab.dll\" },\n  \"TargetResults\": { \"Build\": { \"Result\": \"Success\", \"Items\": [] } }\n}\n";
        assert_eq!(built(ok, ""), Ok("/p/bin/Debug/net9.0/Lab.dll".into()));
        let bad = "/p/Bad.cs(1,30): error CS1525: Invalid expression term '}' [/p/Lab.csproj]\n/p/Bad.cs(1,30): error CS1525: Invalid expression term '}' [/p/Lab.csproj]\n{\n  \"Properties\": { \"TargetPath\": \"/p/x.dll\" },\n  \"TargetResults\": { \"Build\": { \"Result\": \"Failure\", \"Items\": [] } }\n}";
        let e = built(bad, "").unwrap_err();
        assert_eq!(e.matches("CS1525").count(), 1, "doppelte Zeile nur einmal: {e}");
        let e = built("", "MSBUILD : error MSB1011: Specify which project or solution file to use").unwrap_err();
        assert!(e.contains("MSB1011"), "{e}");
    }

    #[test]
    fn asset_fuer_diese_plattform() {
        // CI and dev machines are all covered; an unknown platform only loses the debugger.
        let (p, sum) = asset().expect("Plattform ohne netcoredbg");
        assert!(p.contains("netcoredbg-") && sum.len() == 64);
    }
}
