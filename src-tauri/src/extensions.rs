//! App extensions ("Erweiterungen"): user manifests live in <app_data_dir>/extensions/<folder>/manifest.json.
//! Rust only reads the files; parsing and validation happen in the frontend (src/lib/extensions.logic.ts),
//! v1 extensions are declarative and run no code.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const MAX_MANIFEST: u64 = 256 * 1024;

#[derive(Serialize, Debug)]
pub struct ExtFile {
    dir: String,
    text: Option<String>,
    error: Option<String>,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("extensions"))
}

/// Subfolders with a manifest.json, sorted by name; a broken entry carries its error instead of aborting the scan.
fn scan(dir: &Path) -> Vec<ExtFile> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir() && p.join("manifest.json").is_file()).collect();
    dirs.sort();
    dirs.into_iter()
        .map(|d| {
            let read = || -> Result<String, String> {
                let f = d.join("manifest.json");
                let len = std::fs::metadata(&f).map_err(|e| tr!("Manifest nicht lesbar: {e}", "Manifest not readable: {e}"))?.len();
                if len > MAX_MANIFEST {
                    return Err(tr!("Manifest ist größer als 256 KiB", "Manifest is larger than 256 KiB"));
                }
                let bytes = std::fs::read(&f).map_err(|e| tr!("Manifest nicht lesbar: {e}", "Manifest not readable: {e}"))?;
                let text = String::from_utf8(bytes).map_err(|_| tr!("Manifest ist kein UTF-8", "Manifest is not UTF-8"))?;
                // Checked here because serde_json knows the position; the webview's JSON.parse message is English and has none (WebKit).
                serde_json::from_str::<serde_json::Value>(&text)
                    .map_err(|e| tr!("Manifest ist kein gültiges JSON (Zeile {}, Spalte {})", "Manifest is not valid JSON (line {}, column {})", e.line(), e.column()))?;
                Ok(text)
            };
            let (text, error) = match read() {
                Ok(t) => (Some(t), None),
                Err(e) => (None, Some(e)),
            };
            ExtFile { dir: d.to_string_lossy().into_owned(), text, error }
        })
        .collect()
}

/// Folder for user extensions, created on demand (for "Ordner öffnen").
#[tauri::command]
pub async fn ext_dir(app: AppHandle) -> Result<String, String> {
    let d = root(&app)?;
    crate::git::blocking(move || {
        std::fs::create_dir_all(&d).map_err(|e| tr!("Ordner nicht anlegbar: {e}", "Cannot create folder: {e}"))?;
        Ok(d.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
pub async fn ext_scan(app: AppHandle) -> Result<Vec<ExtFile>, String> {
    let d = root(&app)?;
    crate::git::blocking(move || Ok(scan(&d))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_liest_nur_ordner_mit_manifest() {
        let t = std::env::temp_dir().join(format!("ocui-ext-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        for d in ["b-ok", "a-big", "c-leer", "e-json"] {
            std::fs::create_dir_all(t.join(d)).unwrap();
        }
        std::fs::write(t.join("b-ok/manifest.json"), "{\"id\":\"x\"}").unwrap();
        std::fs::write(t.join("a-big/manifest.json"), vec![b' '; MAX_MANIFEST as usize + 1]).unwrap();
        std::fs::write(t.join("e-json/manifest.json"), "{\n  \"id\": \"x\",\n  name: 1\n}").unwrap();
        std::fs::write(t.join("datei.json"), "{}").unwrap();
        std::fs::create_dir_all(t.join("d-bin")).unwrap();
        std::fs::write(t.join("d-bin/manifest.json"), [0xff, 0xfe]).unwrap();

        let r = scan(&t);
        let names: Vec<_> = r.iter().map(|e| Path::new(&e.dir).file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["a-big", "b-ok", "d-bin", "e-json"]);
        assert_eq!(r[0].error.as_deref(), Some("Manifest ist größer als 256 KiB"));
        assert!(r[0].text.is_none());
        assert_eq!(r[1].text.as_deref(), Some("{\"id\":\"x\"}"));
        assert!(r[1].error.is_none());
        assert_eq!(r[2].error.as_deref(), Some("Manifest ist kein UTF-8"));
        assert_eq!(r[3].error.as_deref(), Some("Manifest ist kein gültiges JSON (Zeile 3, Spalte 3)"));
        // Missing folder: empty, no error.
        assert!(scan(&t.join("fehlt")).is_empty());
        std::fs::remove_dir_all(&t).unwrap();
    }
}
