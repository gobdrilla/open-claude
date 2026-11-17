//! Several Claude accounts, each in its own config folder (`CLAUDE_CONFIG_DIR`), the way Claude Code documents it.
//! claude signs in and refreshes there itself; the app never reads, stores or copies tokens.
//! The standard account is ~/.claude. Further accounts live in app_data/claude-accounts/<id>/ and link the shared
//! parts (settings, skills, plugins, history …) back to ~/.claude, so everything else stays as before.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use crate::git::blocking;

/// Old versions kept copies of logins here (macOS keychain); only removed now.
const LEGACY_SVC: &str = "Open Claude Claude-Konto";

/// Linked into every account: the app reads them from ~/.claude (Verlauf, activity, live sessions, IDE lock files).
const ALWAYS: &[&str] = &["projects", "sessions", "ide", "file-history", "todos", "history.jsonl"];
/// Shared on request, on by default.
const GROUPS: &[(&str, &[&str])] = &[
    ("settings", &["settings.json", "keybindings.json"]),
    ("memory", &["CLAUDE.md"]),
    ("skills", &["skills", "commands", "agents", "output-styles", "workflows"]),
    ("plugins", &["plugins"]),
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Entry {
    id: String,
    /// Last seen in `claude auth status`; empty until signed in.
    #[serde(default)]
    email: String,
    /// GROUPS keys that are linked.
    #[serde(default = "all_groups")]
    shared: Vec<String>,
}

fn all_groups() -> Vec<String> {
    GROUPS.iter().map(|g| g.0.to_string()).collect()
}

#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
struct Index {
    /// Account for new sessions; "" = standard (~/.claude).
    #[serde(default)]
    active: String,
    #[serde(default)]
    accounts: Vec<Entry>,
}

#[derive(Serialize, Debug, Default)]
pub struct Status {
    /// "" = standard account.
    id: String,
    email: String,
    org: String,
    plan: String,
    #[serde(rename = "loggedIn")]
    logged_in: bool,
    /// When the login ends and claude needs /login again (ISO); not the ~8 h access token.
    expires: Option<String>,
    active: bool,
    /// GROUPS keys with their state: true = linked to ~/.claude.
    shared: Vec<(String, bool)>,
}

#[derive(Serialize)]
pub struct Accounts {
    accounts: Vec<Status>,
    /// E-mails whose login copies an older version kept; they need one new sign-in.
    legacy: Vec<String>,
}

struct Paths {
    /// ~/.claude
    claude: PathBuf,
    /// ~/.claude.json of the standard account (inside CLAUDE_CONFIG_DIR if the app itself runs with one)
    json: PathBuf,
    /// app_data/claude-accounts
    own: PathBuf,
}

impl Paths {
    fn real(app: &tauri::AppHandle) -> Result<Self, String> {
        use tauri::Manager;
        let claude = crate::activity::config_dir();
        let json = if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() { claude.join(".claude.json") } else { crate::skills::home().join(".claude.json") };
        Ok(Paths { claude, json, own: app.path().app_data_dir().map_err(|e| e.to_string())?.join("claude-accounts") })
    }
    fn dir(&self, id: &str) -> PathBuf {
        self.own.join(id)
    }
}

/// Ids are ours ("a" + hex), but they arrive from the frontend: never a path.
fn id_ok(id: &str) -> bool {
    id.len() > 1 && id.len() <= 32 && id.starts_with('a') && id.bytes().skip(1).all(|b| b.is_ascii_hexdigit())
}

/// Only e-mail characters: the value ends up on claude's command line (`--email`) and in file names
/// next to accounts.json, so it needs an "@" and must not look like a flag.
pub(crate) fn email_ok(e: &str) -> bool {
    e.len() <= 254 && e.contains('@') && !e.starts_with('-') && e.chars().all(|c| c.is_ascii_alphanumeric() || "@._+-".contains(c))
}

/// A missing file is an empty index; anything else is an error, so no write ever drops the accounts.
fn index(p: &Paths) -> Result<Index, String> {
    match std::fs::read_to_string(p.own.join("accounts.json")) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("accounts.json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Index::default()),
        Err(e) => Err(format!("accounts.json: {e}")),
    }
}

fn index_write(p: &Paths, i: &Index) -> Result<(), String> {
    std::fs::create_dir_all(&p.own).map_err(|e| e.to_string())?;
    crate::skills::atomic_write(&p.own.join("accounts.json"), &serde_json::to_string_pretty(i).map_err(|e| e.to_string())?)
}

static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Read-modify-write of the index under one lock; slow claude calls belong outside.
fn update<T>(p: &Paths, f: impl FnOnce(&mut Index) -> Result<T, String>) -> Result<T, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut idx = index(p)?;
    let out = f(&mut idx)?;
    index_write(p, &idx)?;
    Ok(out)
}

// --- links ---

/// `name` in `dir` points to ~/.claude/`name`.
fn linked(p: &Paths, dir: &Path, name: &str) -> bool {
    let link = dir.join(name);
    #[cfg(windows)]
    if link.is_file() {
        // shortcut: files are hard links on Windows (symlinks need developer mode); same content counts as linked.
        return std::fs::read(&link).ok().is_some_and(|a| std::fs::read(p.claude.join(name)).ok().is_some_and(|b| a == b));
    }
    let _ = p;
    std::fs::read_link(link).is_ok()
}

fn make_link(target: &Path, link: &Path) -> Result<(), String> {
    let dir = !target.file_name().is_some_and(|n| n.to_string_lossy().contains('.'));
    if dir {
        std::fs::create_dir_all(target).map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link).map_err(|e| e.to_string());
    #[cfg(windows)]
    {
        if dir {
            use std::os::windows::process::CommandExt;
            // A junction needs no admin rights or developer mode, unlike a directory symlink. cmd parses the line
            // itself: quoted paths keep "&" literal, "%" and '"' would still be expanded or end the quote.
            let (l, t) = (link.to_string_lossy(), target.to_string_lossy());
            if [&l, &t].iter().any(|s| s.contains(['%', '"'])) {
                return Err(tr!("Pfad mit % oder \" kann nicht verlinkt werden: {}", "Path with % or \" cannot be linked: {}", t));
            }
            let out = crate::quiet("cmd").raw_arg(format!("/c mklink /J \"{l}\" \"{t}\"")).output().map_err(|e| e.to_string())?;
            return if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) };
        }
        // A hard link needs its target; never create files in ~/.claude. ensure links it once it exists.
        // It also breaks when claude replaces the file atomically; the dialog then shows it as not shared.
        if !target.exists() {
            return Ok(());
        }
        std::fs::hard_link(target, link).map_err(|e| e.to_string())
    }
}

fn remove_link(link: &Path) {
    // A link to a folder: remove_file on unix, remove_dir for a Windows junction. Never follows into the target.
    if std::fs::remove_file(link).is_err() {
        let _ = std::fs::remove_dir(link);
    }
}

/// Links what is missing. An own copy that is in the way stays untouched unless `force`: then it is kept as
/// `<name>.own` and replaced by the link.
fn link_all(p: &Paths, dir: &Path, names: &[&str], force: bool) -> Result<(), String> {
    for name in names {
        let link = dir.join(name);
        let exists = std::fs::symlink_metadata(&link).is_ok();
        if exists && (linked(p, dir, name) || !force) {
            continue;
        }
        if exists {
            // Never replace an earlier .own: toggling on, off and on again would lose the first copy.
            let own = (1..)
                .map(|n| dir.join(if n == 1 { format!("{name}.own") } else { format!("{name}.own{n}") }))
                .find(|o| std::fs::symlink_metadata(o).is_err())
                .unwrap_or_default();
            std::fs::rename(&link, own).map_err(|e| e.to_string())?;
        }
        make_link(&p.claude.join(name), &link)?;
    }
    Ok(())
}

/// Turns sharing off: the link goes, a file becomes a copy so the account keeps its settings; a folder starts empty.
fn unlink_all(p: &Paths, dir: &Path, names: &[&str]) -> Result<(), String> {
    for name in names {
        let link = dir.join(name);
        if std::fs::symlink_metadata(&link).is_err() || !linked(p, dir, name) {
            continue;
        }
        remove_link(&link);
        let target = p.claude.join(name);
        if target.is_file() {
            std::fs::copy(&target, &link).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn ensure(p: &Paths, e: &Entry) -> Result<PathBuf, String> {
    let dir = p.dir(&e.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    link_all(p, &dir, ALWAYS, false)?;
    for (g, names) in GROUPS {
        if e.shared.iter().any(|s| s == g) {
            link_all(p, &dir, names, false)?;
        }
    }
    Ok(dir)
}

// --- claude ---

fn claude(dir: Option<&Path>) -> Result<std::process::Command, String> {
    let bin = crate::deps::claude_bin().ok_or_else(|| tr!("claude nicht gefunden", "claude not found"))?;
    let mut cmd = crate::quiet(&bin.to_string_lossy());
    // None inherits the app's own CLAUDE_CONFIG_DIR, like sessions and Paths::claude do.
    if let Some(d) = dir {
        cmd.env("CLAUDE_CONFIG_DIR", d);
    }
    cmd.stdin(Stdio::null());
    Ok(cmd)
}

/// `claude auth status` (JSON, exit 1 when signed out). May renew the short-lived access token as a side effect,
/// like claude itself; it never touches the login's end date.
fn status_of(dir: Option<&Path>) -> Value {
    claude(dir)
        .and_then(|mut c| c.args(["auth", "status"]).output().map_err(|e| e.to_string()))
        .ok()
        .and_then(|o| serde_json::from_slice(&o.stdout).ok())
        .unwrap_or(Value::Null)
}

fn status(id: &str, v: &Value, active: bool, shared: Vec<(String, bool)>) -> Status {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Status {
        id: id.into(),
        email: s("email"),
        org: s("orgName"),
        plan: s("subscriptionType"),
        logged_in: v.get("loggedIn").and_then(Value::as_bool).unwrap_or(false),
        expires: Some(s("loginExpiresAt")).filter(|e| !e.is_empty()),
        active,
        shared,
    }
}

fn shared_state(p: &Paths, e: &Entry) -> Vec<(String, bool)> {
    let dir = p.dir(&e.id);
    // Nothing on either side (Windows makes no link without a target): the group's setting decides.
    let none = |n: &str| !p.claude.join(n).exists() && std::fs::symlink_metadata(dir.join(n)).is_err();
    let on = |g: &str| e.shared.iter().any(|s| s == g);
    GROUPS.iter().map(|(g, names)| (g.to_string(), names.iter().all(|n| linked(p, &dir, n) || (none(n) && on(g))))).collect()
}

/// Logins an older version copied. Read from its index, the copies themselves are never opened.
fn legacy(p: &Paths) -> Vec<String> {
    #[derive(Deserialize)]
    struct Old {
        email: String,
    }
    let old: Vec<Old> = std::fs::read_to_string(p.own.join("index.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    old.into_iter().map(|o| o.email).filter(|e| email_ok(e)).collect()
}

/// Deletes the stored copy of an old login and its line in the old index.
fn legacy_forget(p: &Paths, email: &str) -> Result<(), String> {
    if !email_ok(email) {
        return Err(tr!("Ungültige E-Mail", "Invalid email"));
    }
    if cfg!(target_os = "macos") {
        let _ = crate::quiet("security").args(["delete-generic-password", "-s", LEGACY_SVC, "-a", email]).stdin(Stdio::null()).output();
    }
    let _ = std::fs::remove_file(p.own.join(format!("{email}.json")));
    let rest: Vec<Value> = legacy(p).into_iter().filter(|e| e != email).map(|e| serde_json::json!({ "email": e })).collect();
    if rest.is_empty() {
        let _ = std::fs::remove_file(p.own.join("index.json"));
        Ok(())
    } else {
        crate::skills::atomic_write(&p.own.join("index.json"), &Value::Array(rest).to_string())
    }
}

fn list(p: &Paths) -> Result<Accounts, String> {
    let idx = index(p)?;
    // One claude process per account, in parallel: each takes ~0.1-1 s.
    let std = std::thread::spawn(|| status_of(None));
    let others: Vec<_> = idx
        .accounts
        .iter()
        .map(|e| {
            let dir = p.dir(&e.id);
            std::thread::spawn(move || status_of(Some(&dir)))
        })
        .collect();
    let mut out = vec![status("", &std.join().unwrap_or(Value::Null), idx.active.is_empty(), vec![])];
    for (e, h) in idx.accounts.iter().zip(others) {
        out.push(status(&e.id, &h.join().unwrap_or(Value::Null), e.id == idx.active, shared_state(p, e)));
    }
    // Remember new e-mails; re-read under the lock, the index may have changed meanwhile (added, remove).
    let seen: Vec<(String, String)> =
        out[1..].iter().zip(&idx.accounts).filter(|(st, e)| !st.email.is_empty() && st.email != e.email).map(|(st, _)| (st.id.clone(), st.email.clone())).collect();
    if !seen.is_empty() {
        update(p, |i| {
            for e in &mut i.accounts {
                if let Some((_, m)) = seen.iter().find(|s| s.0 == e.id) {
                    e.email = m.clone();
                }
            }
            Ok(())
        })?;
    }
    let known: Vec<&str> = out.iter().map(|s| s.email.as_str()).collect();
    let legacy = legacy(p).into_iter().filter(|e| !known.contains(&e.as_str())).collect();
    Ok(Accounts { accounts: out, legacy })
}

fn add(p: &Paths) -> Result<String, String> {
    let id = format!("a{:012x}", rand_u64() & 0xffff_ffff_ffff);
    let e = Entry { id: id.clone(), email: String::new(), shared: all_groups() };
    let dir = ensure(p, &e)?;
    // Without these claude greets the new folder with its first-run setup (theme picker) before the login.
    let std: Value = std::fs::read_to_string(&p.json).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let seed: serde_json::Map<String, Value> =
        ["theme", "hasCompletedOnboarding", "lastOnboardingVersion"].iter().filter_map(|k| Some((k.to_string(), std.get(k)?.clone()))).collect();
    std::fs::write(dir.join(".claude.json"), Value::Object(seed).to_string()).map_err(|e| e.to_string())?;
    update(p, |i| {
        i.accounts.push(e);
        Ok(())
    })?;
    Ok(id)
}

fn rand_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish()
}

/// After `claude auth login` in a new folder: keeps it if a new account signed in, otherwise removes it again.
fn added(p: &Paths, id: &str) -> Result<Option<String>, String> {
    let st = status(id, &status_of(Some(&p.dir(id))), false, vec![]);
    let std = status("", &status_of(None), false, vec![]).email;
    let taken = update(p, |idx| {
        let taken = st.logged_in && (st.email == std || idx.accounts.iter().any(|e| e.id != id && e.email == st.email));
        if !st.logged_in || taken {
            remove_dir(p, idx, id)?;
        } else if let Some(e) = idx.accounts.iter_mut().find(|e| e.id == id) {
            e.email = st.email.clone();
        }
        Ok(taken)
    })?;
    if taken {
        return Err(tr!("{} ist schon angemeldet.", "{} is already signed in.", st.email));
    }
    if !st.logged_in {
        return Ok(None);
    }
    if legacy(p).contains(&st.email) {
        legacy_forget(p, &st.email)?;
    }
    Ok(Some(st.email))
}

fn remove_dir(p: &Paths, idx: &mut Index, id: &str) -> Result<(), String> {
    idx.accounts.retain(|e| e.id != id);
    if idx.active == id {
        idx.active.clear();
    }
    let dir = p.dir(id);
    // Links first, so nothing can ever reach into ~/.claude; remove_dir_all does not follow links either.
    for name in ALWAYS.iter().chain(GROUPS.iter().flat_map(|g| g.1.iter())) {
        if linked(p, &dir, name) {
            remove_link(&dir.join(name));
        }
    }
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

fn entry(idx: &Index, id: &str) -> Result<Entry, String> {
    if !id_ok(id) {
        return Err(tr!("Unbekanntes Konto", "Unknown account"));
    }
    idx.accounts.iter().find(|e| e.id == id).cloned().ok_or_else(|| tr!("Unbekanntes Konto", "Unknown account"))
}

/// Config folder for `id` ("" = standard), links checked. For claude_login and new sessions.
pub(crate) fn dir_for(app: &tauri::AppHandle, id: &str) -> Result<Option<PathBuf>, String> {
    if id.is_empty() {
        return Ok(None);
    }
    let p = Paths::real(app)?;
    let e = entry(&index(&p)?, id)?;
    ensure(&p, &e).map(Some)
}

/// Folder of the account new sessions use; None = standard.
pub(crate) fn active_dir(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let p = Paths::real(app)?;
    let idx = index(&p)?;
    idx.accounts.iter().find(|e| e.id == idx.active).map(|e| ensure(&p, e)).transpose()
}

#[tauri::command]
pub async fn claude_accounts(app: tauri::AppHandle) -> Result<Accounts, String> {
    let p = Paths::real(&app)?;
    blocking(move || list(&p)).await
}

#[tauri::command]
pub async fn claude_account_add(app: tauri::AppHandle) -> Result<String, String> {
    let p = Paths::real(&app)?;
    blocking(move || add(&p)).await
}

#[tauri::command]
pub async fn claude_account_added(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let p = Paths::real(&app)?;
    blocking(move || {
        entry(&index(&p)?, &id)?;
        added(&p, &id)
    })
    .await
}

#[tauri::command]
pub async fn claude_account_use(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let p = Paths::real(&app)?;
    blocking(move || {
        update(&p, |idx| {
            if !id.is_empty() {
                entry(idx, &id)?;
            }
            idx.active = id;
            Ok(())
        })
    })
    .await
}

/// Signs out (claude revokes the tokens) and, for an extra account, removes its folder.
#[tauri::command]
pub async fn claude_account_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let p = Paths::real(&app)?;
    blocking(move || {
        let dir = if id.is_empty() { None } else { Some(p.dir(&entry(&index(&p)?, &id)?.id)) };
        let out = claude(dir.as_deref())?.args(["auth", "logout"]).output().map_err(|e| e.to_string())?;
        if !out.status.success() && id.is_empty() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        if !id.is_empty() {
            update(&p, |idx| remove_dir(&p, idx, &id))?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn claude_account_share(app: tauri::AppHandle, id: String, group: String, on: bool) -> Result<(), String> {
    let p = Paths::real(&app)?;
    blocking(move || {
        update(&p, |idx| {
            let e = entry(idx, &id)?;
            let names = GROUPS.iter().find(|g| g.0 == group).ok_or_else(|| tr!("Unbekannter Bereich", "Unknown area"))?.1;
            let dir = p.dir(&e.id);
            if on { link_all(&p, &dir, names, true)? } else { unlink_all(&p, &dir, names)? }
            if let Some(e) = idx.accounts.iter_mut().find(|e| e.id == id) {
                e.shared.retain(|g| g != &group);
                if on {
                    e.shared.push(group);
                }
            }
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn claude_account_legacy_forget(app: tauri::AppHandle, email: String) -> Result<(), String> {
    let p = Paths::real(&app)?;
    blocking(move || legacy_forget(&p, &email)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> Paths {
        let d = std::env::temp_dir().join(format!("ocui-acct-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".claude/skills")).unwrap();
        std::fs::write(d.join(".claude/settings.json"), "{\"a\":1}").unwrap();
        std::fs::write(d.join(".claude.json"), r#"{"theme":"dark","hasCompletedOnboarding":true,"oauthAccount":{"emailAddress":"x@y.z"}}"#).unwrap();
        Paths { claude: d.join(".claude"), json: d.join(".claude.json"), own: d.join("own") }
    }

    #[test]
    fn eigener_ordner_teilt_per_link() {
        let p = tmp("links");
        let id = add(&p).unwrap();
        assert!(id_ok(&id));
        let dir = p.dir(&id);
        // Only first-run answers are taken over, never the account
        assert_eq!(std::fs::read_to_string(dir.join(".claude.json")).unwrap(), r#"{"hasCompletedOnboarding":true,"theme":"dark"}"#);
        // Shared parts point into ~/.claude, the folder itself holds no login
        assert_eq!(std::fs::read_to_string(dir.join("settings.json")).unwrap(), "{\"a\":1}");
        assert!(linked(&p, &dir, "skills") && linked(&p, &dir, "projects"));
        assert!(p.claude.join("projects").is_dir());
        let e = entry(&index(&p).unwrap(), &id).unwrap();
        assert!(shared_state(&p, &e).iter().all(|s| s.1));

        // Off: settings become an own copy, ~/.claude stays
        unlink_all(&p, &dir, &["settings.json", "skills"]).unwrap();
        assert!(!linked(&p, &dir, "settings.json"));
        assert_eq!(std::fs::read_to_string(dir.join("settings.json")).unwrap(), "{\"a\":1}");
        assert!(!dir.join("skills").exists() && p.claude.join("skills").is_dir());
        // ensure leaves an own copy alone, force keeps it as .own
        link_all(&p, &dir, &["settings.json"], false).unwrap();
        assert!(!linked(&p, &dir, "settings.json"));
        link_all(&p, &dir, &["settings.json"], true).unwrap();
        assert!(linked(&p, &dir, "settings.json") && dir.join("settings.json.own").is_file());
        // Off and on again keeps the first .own
        std::fs::write(dir.join("settings.json.own"), "first").unwrap();
        unlink_all(&p, &dir, &["settings.json"]).unwrap();
        link_all(&p, &dir, &["settings.json"], true).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("settings.json.own")).unwrap(), "first");
        assert!(dir.join("settings.json.own2").is_file());

        // Removing never reaches into ~/.claude
        let mut idx = index(&p).unwrap();
        remove_dir(&p, &mut idx, &id).unwrap();
        assert!(!dir.exists());
        assert!(p.claude.join("settings.json").is_file() && p.claude.join("skills").is_dir());
        assert!(idx.accounts.is_empty());
        let _ = std::fs::remove_dir_all(p.claude.parent().unwrap());
    }

    #[test]
    fn ids_und_alte_anmeldungen() {
        let p = tmp("ids");
        for bad in ["", "a", "../x", "a/../b", "b123", "aXYZ"] {
            assert!(!id_ok(bad), "{bad}");
            assert!(entry(&index(&p).unwrap(), bad).is_err());
        }
        for bad in ["", "--help", "-x@y.z", "accounts", "index", "a b@c.d", "a@b;c"] {
            assert!(!email_ok(bad), "{bad}");
        }
        assert!(email_ok("first.last+tag@sub-domain.de"));
        // A broken index is an error, never silently empty (the next write would drop every account)
        std::fs::create_dir_all(&p.own).unwrap();
        std::fs::write(p.own.join("accounts.json"), "{broken").unwrap();
        assert!(index(&p).is_err() && update(&p, |_| Ok(())).is_err());
        assert_eq!(std::fs::read_to_string(p.own.join("accounts.json")).unwrap(), "{broken");
        std::fs::remove_file(p.own.join("accounts.json")).unwrap();
        std::fs::create_dir_all(&p.own).unwrap();
        std::fs::write(p.own.join("index.json"), r#"[{"email":"a@x.de","org":"O"},{"email":"../evil","org":""}]"#).unwrap();
        std::fs::write(p.own.join("a@x.de.json"), "{}").unwrap();
        assert_eq!(legacy(&p), ["a@x.de"]);
        legacy_forget(&p, "a@x.de").unwrap();
        assert!(legacy(&p).is_empty() && !p.own.join("a@x.de.json").exists());
        let _ = std::fs::remove_dir_all(p.claude.parent().unwrap());
    }

    #[test]
    fn status_aus_auth_status() {
        let v = serde_json::json!({ "loggedIn": true, "email": "a@x.de", "orgName": "O", "subscriptionType": "max", "loginExpiresAt": "2026-12-09T03:59:55.222Z" });
        let s = status("", &v, true, vec![]);
        assert!(s.logged_in && s.active);
        assert_eq!((s.email.as_str(), s.plan.as_str(), s.expires.as_deref()), ("a@x.de", "max", Some("2026-12-09T03:59:55.222Z")));
        let out = status("", &serde_json::json!({ "loggedIn": false, "loginExpiresAt": null }), false, vec![]);
        assert!(!out.logged_in && out.expires.is_none());
    }
}
