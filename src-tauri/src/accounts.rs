//! Mehrere Claude-Konten. claude kennt nur eine Anmeldung: die Tokens (macOS im Schluesselbund
//! "Claude Code-credentials", sonst ~/.claude/.credentials.json) und `oauthAccount` in ~/.claude.json.
//! Die App merkt sich beides je Konto und tauscht es beim Wechsel; Einstellungen und Verlauf bleiben geteilt.
//! Gemerkte Anmeldungen liegen wie bei claude selbst: macOS im Schluesselbund, sonst als Datei (nur fuer den Nutzer lesbar).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use crate::git::blocking;

const CLAUDE_SVC: &str = "Claude Code-credentials";
const OWN_SVC: &str = "Open Claude Claude-Konto";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Account {
    email: String,
    org: String,
}

#[derive(Serialize)]
pub struct Accounts {
    current: Option<Account>,
    saved: Vec<Account>,
}

/// Was je Konto gemerkt wird.
#[derive(Serialize, Deserialize)]
struct Login {
    creds: String,
    oauth: Value,
}

/// Wo claude und die App ihre Daten haben; in Tests ein Temp-Ordner und eine Datei statt Schluesselbund.
struct Paths {
    home: PathBuf,
    config: PathBuf,
    own: PathBuf,
    keychain: bool,
}

impl Paths {
    fn real(app: &tauri::AppHandle) -> Result<Self, String> {
        use tauri::Manager;
        Ok(Paths {
            home: crate::skills::home(),
            config: crate::activity::config_dir(),
            own: app.path().app_data_dir().map_err(|e| e.to_string())?.join("claude-accounts"),
            keychain: cfg!(target_os = "macos"),
        })
    }
}

/// Nur E-Mail-Zeichen: der Wert landet als Schluesselbund-Konto bzw. Dateiname.
fn email_ok(e: &str) -> bool {
    !e.is_empty() && e.len() <= 254 && e.chars().all(|c| c.is_ascii_alphanumeric() || "@._+-".contains(c))
}

fn kc_read(svc: &str, acct: Option<&str>) -> Option<String> {
    let mut cmd = crate::quiet("security");
    cmd.args(["find-generic-password", "-s", svc, "-w"]);
    if let Some(a) = acct {
        cmd.args(["-a", a]);
    }
    let out = cmd.stdin(Stdio::null()).output().ok().filter(|o| o.status.success())?;
    Some(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string())
}

/// Ueber `security -i` und stdin, hex-kodiert: so steht das Geheimnis nie in der Prozessliste.
fn kc_write(svc: &str, acct: &str, secret: &str) -> Result<(), String> {
    let hex: String = secret.bytes().map(|b| format!("{b:02x}")).collect();
    let mut child = crate::quiet("security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    writeln!(child.stdin.take().ok_or("stdin fehlt")?, "add-generic-password -U -a \"{acct}\" -s \"{svc}\" -X {hex}").map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let err = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() || err.contains("error") {
        return Err(format!("Schlüsselbund: {}", err.trim()));
    }
    Ok(())
}

fn kc_delete(svc: &str, acct: &str) {
    let _ = crate::quiet("security").args(["delete-generic-password", "-s", svc, "-a", acct]).stdin(Stdio::null()).output();
}

fn private_write(file: &Path, text: &str) -> Result<(), String> {
    std::fs::create_dir_all(file.parent().ok_or("kein Ordner")?).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("tmp");
    {
        let mut o = std::fs::OpenOptions::new();
        o.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
        o.open(&tmp).and_then(|mut f| f.write_all(text.as_bytes())).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

/// Aktuelle Tokens von claude.
fn creds_read(p: &Paths) -> Option<String> {
    if p.keychain {
        return kc_read(CLAUDE_SVC, None);
    }
    std::fs::read_to_string(p.config.join(".credentials.json")).ok()
}

fn creds_write(p: &Paths, creds: &str) -> Result<(), String> {
    if p.keychain {
        // Konto wie claude es anlegt: der Login-Name
        let user = std::env::var("USER").unwrap_or_default();
        return kc_write(CLAUDE_SVC, &user, creds);
    }
    private_write(&p.config.join(".credentials.json"), creds)
}

/// Mit CLAUDE_CONFIG_DIR liegt .claude.json dort, sonst im Home.
fn claude_json_path(p: &Paths) -> PathBuf {
    if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() { p.config.join(".claude.json") } else { p.home.join(".claude.json") }
}

fn claude_json(p: &Paths) -> Result<Map<String, Value>, String> {
    match std::fs::read_to_string(claude_json_path(p)) {
        Ok(t) => match serde_json::from_str(&t) {
            Ok(Value::Object(m)) => Ok(m),
            _ => Err("~/.claude.json ist kein JSON-Objekt".into()),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Nur `oauthAccount` ersetzen; der Rest der Datei bleibt, wie claude ihn schrieb.
fn oauth_write(p: &Paths, oauth: Value) -> Result<(), String> {
    let mut all = claude_json(p)?;
    all.insert("oauthAccount".into(), oauth);
    crate::skills::atomic_write(&claude_json_path(p), &(serde_json::to_string_pretty(&all).map_err(|e| e.to_string())? + "\n"))
}

fn account_of(oauth: &Value) -> Option<Account> {
    let email = oauth.get("emailAddress")?.as_str()?.to_string();
    let org = oauth.get("organizationName").and_then(Value::as_str).unwrap_or("").to_string();
    email_ok(&email).then_some(Account { email, org })
}

fn current(p: &Paths) -> Option<(Account, Login)> {
    let creds = creds_read(p).filter(|c| !c.trim().is_empty())?;
    let oauth = claude_json(p).ok()?.remove("oauthAccount")?;
    Some((account_of(&oauth)?, Login { creds, oauth }))
}

fn index(p: &Paths) -> Vec<Account> {
    std::fs::read_to_string(p.own.join("index.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn index_write(p: &Paths, list: &[Account]) -> Result<(), String> {
    private_write(&p.own.join("index.json"), &serde_json::to_string_pretty(list).map_err(|e| e.to_string())?)
}

fn stored_read(p: &Paths, email: &str) -> Option<Login> {
    let text = if p.keychain { kc_read(OWN_SVC, Some(email))? } else { std::fs::read_to_string(p.own.join(format!("{email}.json"))).ok()? };
    serde_json::from_str(&text).ok()
}

fn stored_write(p: &Paths, email: &str, l: &Login) -> Result<(), String> {
    let text = serde_json::to_string(l).map_err(|e| e.to_string())?;
    if p.keychain {
        return kc_write(OWN_SVC, email, &text);
    }
    private_write(&p.own.join(format!("{email}.json")), &text)
}

/// Aktuelle Anmeldung merken (nach dem Anmelden, vor jedem Wechsel: claude erneuert Tokens selbst).
fn save(p: &Paths) -> Result<Option<Account>, String> {
    let Some((acct, login)) = current(p) else { return Ok(None) };
    stored_write(p, &acct.email, &login)?;
    let mut list: Vec<Account> = index(p).into_iter().filter(|a| a.email != acct.email).collect();
    list.push(acct.clone());
    list.sort_by(|a, b| a.email.cmp(&b.email));
    index_write(p, &list)?;
    Ok(Some(acct))
}

fn switch(p: &Paths, email: &str) -> Result<(), String> {
    if !email_ok(email) {
        return Err("Ungültige E-Mail".into());
    }
    let target = stored_read(p, email).ok_or(format!("Keine gemerkte Anmeldung für {email}"))?;
    save(p)?;
    creds_write(p, &target.creds)?;
    oauth_write(p, target.oauth)
}

fn forget(p: &Paths, email: &str) -> Result<(), String> {
    if !email_ok(email) {
        return Err("Ungültige E-Mail".into());
    }
    if p.keychain {
        kc_delete(OWN_SVC, email);
    } else {
        let _ = std::fs::remove_file(p.own.join(format!("{email}.json")));
    }
    index_write(p, &index(p).into_iter().filter(|a| a.email != email).collect::<Vec<_>>())
}

#[tauri::command]
pub async fn claude_accounts(app: tauri::AppHandle) -> Result<Accounts, String> {
    let p = Paths::real(&app)?;
    blocking(move || Ok(Accounts { current: current(&p).map(|c| c.0), saved: index(&p) })).await
}

#[tauri::command]
pub async fn claude_account_save(app: tauri::AppHandle) -> Result<Option<Account>, String> {
    let p = Paths::real(&app)?;
    blocking(move || save(&p)).await
}

#[tauri::command]
pub async fn claude_account_switch(app: tauri::AppHandle, email: String) -> Result<(), String> {
    let p = Paths::real(&app)?;
    blocking(move || switch(&p, &email)).await
}

#[tauri::command]
pub async fn claude_account_forget(app: tauri::AppHandle, email: String) -> Result<(), String> {
    let p = Paths::real(&app)?;
    blocking(move || forget(&p, &email)).await
}

/// `claude auth logout`: claude meldet ab (und widerruft die Tokens); die gemerkte Kopie faellt mit weg.
#[tauri::command]
pub async fn claude_logout(app: tauri::AppHandle) -> Result<(), String> {
    let p = Paths::real(&app)?;
    blocking(move || {
        let was = current(&p).map(|c| c.0.email);
        let claude = crate::deps::claude_bin().ok_or("claude nicht gefunden")?;
        let out = crate::quiet(&claude.to_string_lossy()).args(["auth", "logout"]).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        if let Some(e) = was {
            forget(&p, &e)?;
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> Paths {
        let d = std::env::temp_dir().join(format!("ocui-acct-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".claude")).unwrap();
        Paths { home: d.clone(), config: d.join(".claude"), own: d.join("own"), keychain: false }
    }

    fn login_as(p: &Paths, email: &str, token: &str) {
        std::fs::write(p.config.join(".credentials.json"), token).unwrap();
        let mut all = claude_json(p).unwrap();
        all.insert("oauthAccount".into(), serde_json::json!({ "emailAddress": email, "organizationName": "Org" }));
        all.insert("projects".into(), serde_json::json!({ "/w": { "x": 1 } }));
        std::fs::write(p.home.join(".claude.json"), Value::Object(all).to_string()).unwrap();
    }

    #[test]
    fn merken_und_wechseln() {
        let p = tmp("switch");
        assert!(save(&p).unwrap().is_none());
        login_as(&p, "a@x.de", "TOKEN-A");
        save(&p).unwrap();
        login_as(&p, "b@x.de", "TOKEN-B");
        // Wechsel merkt erst das aktuelle (b) und setzt dann a ein
        switch(&p, "a@x.de").unwrap();
        assert_eq!(std::fs::read_to_string(p.config.join(".credentials.json")).unwrap(), "TOKEN-A");
        assert_eq!(current(&p).unwrap().0.email, "a@x.de");
        assert_eq!(index(&p).iter().map(|a| a.email.as_str()).collect::<Vec<_>>(), ["a@x.de", "b@x.de"]);
        // Rest von ~/.claude.json bleibt
        assert!(claude_json(&p).unwrap().contains_key("projects"));
        switch(&p, "b@x.de").unwrap();
        assert_eq!(std::fs::read_to_string(p.config.join(".credentials.json")).unwrap(), "TOKEN-B");
        forget(&p, "a@x.de").unwrap();
        assert_eq!(index(&p).len(), 1);
        assert!(switch(&p, "a@x.de").is_err());
        assert!(switch(&p, "../x").is_err());
        let _ = std::fs::remove_dir_all(&p.home);
    }

    #[cfg(unix)]
    #[test]
    fn gemerkte_dateien_nur_fuer_den_nutzer() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp("mode");
        login_as(&p, "a@x.de", "T");
        save(&p).unwrap();
        let mode = std::fs::metadata(p.own.join("a@x.de.json")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_dir_all(&p.home);
    }
}
