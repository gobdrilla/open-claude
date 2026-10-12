//! Language-Server fuer den Editor: je (Projekt, Server) ein Prozess ueber stdio. Rust haelt nur Prozess,
//! Content-Length-Framing und die zuletzt gemeldeten Diagnostics (fuer getDiagnostics im IDE-Protokoll);
//! den Client macht @codemirror/lsp-client im Frontend (src/lib/lsp.svelte.ts).
//! Server fuehren Projektcode aus (build.rs, Proc-Macros, Plugins): das Frontend startet sie nur nach Freigabe,
//! und es nennt nur einen Schluessel aus SERVERS, nie einen Befehl.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{mpsc, Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

/// (Schluessel, Programm, Argumente, liegt auch in node_modules/.bin, Installationshinweis).
/// Schluessel muessen zu SERVERS in src/lib/lsp.logic.ts passen.
const SERVERS: &[(&str, &str, &[&str], bool, &str)] = &[
    ("typescript", "typescript-language-server", &["--stdio"], true, "npm i -g typescript-language-server typescript"),
    ("svelte", "svelteserver", &["--stdio"], true, "npm i -g svelte-language-server"),
    ("rust", "rust-analyzer", &[], false, "rustup component add rust-analyzer"),
    ("python", "pyright-langserver", &["--stdio"], true, "npm i -g pyright"),
    ("go", "gopls", &[], false, "go install golang.org/x/tools/gopls@latest"),
    // Ohne --background-index: sonst legt clangd .cache/ ins Projekt.
    ("clangd", "clangd", &[], false, "Xcode Command Line Tools, LLVM oder Paketmanager (clangd)"),
    ("csharp", "csharp-ls", &[], false, "dotnet tool install -g csharp-ls"),
    ("swift", "sourcekit-lsp", &[], false, "Xcode bzw. Swift-Toolchain"),
    ("json", "vscode-json-language-server", &["--stdio"], true, "npm i -g vscode-langservers-extracted"),
    ("css", "vscode-css-language-server", &["--stdio"], true, "npm i -g vscode-langservers-extracted"),
    ("html", "vscode-html-language-server", &["--stdio"], true, "npm i -g vscode-langservers-extracted"),
    ("yaml", "yaml-language-server", &["--stdio"], true, "npm i -g yaml-language-server"),
];

/// Nachrichten an das Frontend: eine LSP-Nachricht (JSON ohne Header) oder das Ende des Prozesses.
#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Out {
    Msg { m: String },
    Exit { code: Option<i32>, err: String },
}

struct Server {
    pid: u32,
    tx: mpsc::Sender<String>,
    // uri -> Diagnostics-Liste, wie vom Server gemeldet.
    diags: Arc<Mutex<HashMap<String, Value>>>,
}

#[derive(Default)]
pub struct Lsps(Mutex<HashMap<(PathBuf, String), Server>>);

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Lsps {
    pub fn kill_all(&self) {
        for (_, s) in guard(&self.0).drain() {
            crate::kill_tree(s.pid);
        }
    }

    /// Format wie getDiagnostics der VS-Code-Extension: [{uri, diagnostics:[{message, severity, range, source, code}]}].
    pub fn diagnostics(&self, repo: &str, uri: Option<&str>) -> Value {
        let Ok(root) = Path::new(repo).canonicalize() else { return json!([]) };
        let want = uri.map(norm);
        let mut out = Vec::new();
        for ((r, _), s) in guard(&self.0).iter() {
            if *r != root {
                continue;
            }
            for (u, list) in guard(&s.diags).iter() {
                if want.as_ref().is_some_and(|w| *w != norm(u)) {
                    continue;
                }
                let diagnostics: Vec<Value> = list
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|d| {
                        let mut d = d.clone();
                        d["severity"] = severity(d["severity"].as_u64()).into();
                        d
                    })
                    .collect();
                out.push(json!({ "uri": u, "diagnostics": diagnostics }));
            }
        }
        Value::Array(out)
    }
}

fn severity(n: Option<u64>) -> &'static str {
    match n {
        Some(2) => "Warning",
        Some(3) => "Information",
        Some(4) => "Hint",
        _ => "Error",
    }
}

/// file-URI -> Pfad, damit unterschiedliche Kodierungen (c%3A, Leerzeichen) gleich vergleichen.
fn norm(uri: &str) -> Option<PathBuf> {
    tauri::Url::parse(uri).ok()?.to_file_path().ok()
}

/// Naechste vollstaendige Nachricht aus buf entnehmen. None = noch unvollstaendig, Err = Header ohne Content-Length.
fn frame(buf: &mut Vec<u8>) -> Option<Result<String, String>> {
    let end = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&buf[..end]).to_string();
    let len = head
        .lines()
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse::<usize>().ok());
    let Some(len) = len else {
        buf.drain(..end + 4);
        return Some(Err(format!("Header ohne Content-Length: {head}")));
    };
    if buf.len() < end + 4 + len {
        return None;
    }
    let body = String::from_utf8_lossy(&buf[end + 4..end + 4 + len]).into_owned();
    buf.drain(..end + 4 + len);
    Some(Ok(body))
}

/// publishDiagnostics im Cache nachfuehren; leere Liste = Datei ohne Befund.
fn remember(diags: &Mutex<HashMap<String, Value>>, msg: &str) {
    // Billiger Vorfilter: die meisten Nachrichten sind Antworten.
    if !msg.contains("textDocument/publishDiagnostics") {
        return;
    }
    let Ok(v) = serde_json::from_str::<Value>(msg) else { return };
    if v["method"] != "textDocument/publishDiagnostics" {
        return;
    }
    let Some(uri) = v["params"]["uri"].as_str() else { return };
    let list = &v["params"]["diagnostics"];
    let mut d = guard(diags);
    if list.as_array().is_none_or(|l| l.is_empty()) {
        d.remove(uri);
    } else {
        d.insert(uri.to_string(), list.clone());
    }
}

fn resolve(root: &Path, cmd: &str, npm: bool) -> Option<PathBuf> {
    let local = npm.then(|| crate::runner::local_bin(root, root, cmd, cfg!(windows), Path::is_file)).flatten();
    local.or_else(|| crate::deps::which(cmd))
}

/// Server fuer das Projekt starten; laeuft schon einer, wird er ersetzt (Webview neu geladen: kein Leck).
#[tauri::command]
pub async fn lsp_start(app: AppHandle, repo: String, server: String, on: Channel<Out>) -> Result<(), String> {
    crate::git::blocking(move || start(app, &repo, &server, on)).await
}

fn start<R: Runtime>(app: AppHandle<R>, repo: &str, server: &str, on: Channel<Out>) -> Result<(), String> {
    let root = Path::new(repo).canonicalize().map_err(|e| format!("Projekt nicht gefunden: {e}"))?;
    let &(key, cmd, args, npm, hint) =
        SERVERS.iter().find(|s| s.0 == server).ok_or_else(|| format!("Unbekannter Language-Server: {server}"))?;
    let prog = resolve(&root, cmd, npm).ok_or_else(|| format!("{cmd} nicht gefunden. Installieren: {hint}"))?;

    let state = app.state::<Lsps>();
    let id = (root.clone(), key.to_string());
    // Eigenes let: der Guard faellt vor kill_tree, lsp_send wartet nicht auf das Beenden.
    let old = guard(&state.0).remove(&id);
    if let Some(old) = old {
        crate::kill_tree(old.pid);
    }
    let mut c = crate::quiet(&prog.to_string_lossy());
    c.args(args).current_dir(&root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Eigene Gruppe: kill_tree trifft auch Kinder (tsserver, Proc-Macro-Server).
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut c, 0);
    let mut child = c.spawn().map_err(|e| format!("{cmd} konnte nicht gestartet werden: {e}"))?;
    let pid = child.id();
    let (mut stdin, stdout, stderr) = (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let (tx, rx) = mpsc::channel::<String>();
    let diags = Arc::new(Mutex::new(HashMap::new()));
    // Eintrag vor den Threads: ein sofort endender Prozess raeumt sonst einen Eintrag ab, den es noch nicht gibt.
    guard(&state.0).insert(id.clone(), Server { pid, tx, diags: diags.clone() });

    std::thread::spawn(move || {
        let Some(w) = stdin.as_mut() else { return };
        for m in rx {
            let ok = write!(w, "Content-Length: {}\r\n\r\n", m.len()).and_then(|()| w.write_all(m.as_bytes())).and_then(|()| w.flush());
            if ok.is_err() {
                return;
            }
        }
    });
    let out = Arc::new(on);
    let reader = {
        let out = out.clone();
        std::thread::spawn(move || {
            let Some(mut r) = stdout else { return };
            let (mut buf, mut chunk) = (Vec::new(), vec![0u8; 64 << 10]);
            while let Ok(n @ 1..) = r.read(&mut chunk) {
                buf.extend_from_slice(&chunk[..n]);
                while let Some(m) = frame(&mut buf) {
                    let Ok(m) = m else { continue };
                    remember(&diags, &m);
                    if out.send(Out::Msg { m }).is_err() {
                        return;
                    }
                }
            }
        })
    };
    // Letzte Zeilen von stderr fuer die Meldung, falls der Server abstuerzt.
    let tail = Arc::new(Mutex::new(Vec::<String>::new()));
    let errs = {
        let tail = tail.clone();
        std::thread::spawn(move || {
            let Some(e) = stderr else { return };
            // Bytes statt lines(): kein UTF-8 (Windows-Codepage) beendete sonst das Lesen, der volle Pipe-Puffer blockiert den Server.
            for line in BufReader::new(e).split(b'\n').map_while(Result::ok) {
                let mut t = guard(&tail);
                t.push(String::from_utf8_lossy(&line).trim_end().to_string());
                if t.len() > 20 {
                    t.remove(0);
                }
            }
        })
    };
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        // Letzte Ausgabe und stderr-Tail abwarten; haelt ein Enkel die Pipes offen, nicht ewig (sonst nie Exit).
        for _ in 0..20 {
            if reader.is_finished() && errs.is_finished() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let state = app.state::<Lsps>();
        let mut map = guard(&state.0);
        // Nur den eigenen Eintrag: nach einem Neustart gehoert der Schluessel schon dem neuen Prozess.
        if map.get(&id).is_some_and(|s| s.pid == pid) {
            map.remove(&id);
        }
        drop(map);
        let tail = guard(&tail).join("\n");
        let err = format!("{cmd} beendet (Code {}). {tail}\nPrüfen/Installieren: {hint}", code.map_or("–".into(), |c| c.to_string()));
        let _ = out.send(Out::Exit { code, err });
    });
    Ok(())
}

/// Nachricht an den Server. Synchron und nur eine Queue: die Reihenfolge bestimmt das Frontend (serielle Kette).
#[tauri::command]
pub fn lsp_send(app: AppHandle, repo: String, server: String, msg: String) -> Result<(), String> {
    send(&app, &repo, server, msg)
}

fn send<R: Runtime>(app: &AppHandle<R>, repo: &str, server: String, msg: String) -> Result<(), String> {
    let root = Path::new(repo).canonicalize().map_err(|e| e.to_string())?;
    let state = app.state::<Lsps>();
    let map = guard(&state.0);
    let s = map.get(&(root, server)).ok_or("Language-Server läuft nicht")?;
    s.tx.send(msg).map_err(|_| "Language-Server läuft nicht".to_string())
}

/// Server beenden (Projekt geschlossen). Unbekannt: nichts. Async: kill_tree wartet (taskkill), nicht auf dem Main-Thread.
#[tauri::command]
pub async fn lsp_stop(app: AppHandle, repo: String, server: String) -> Result<(), String> {
    crate::git::blocking(move || {
        stop(&app, &repo, server);
        Ok(())
    })
    .await
}

fn stop<R: Runtime>(app: &AppHandle<R>, repo: &str, server: String) {
    // Ordner schon weg: der Schluessel ist meist der Pfad selbst.
    let root = Path::new(repo).canonicalize().unwrap_or_else(|_| repo.into());
    let s = guard(&app.state::<Lsps>().0).remove(&(root, server));
    if let Some(s) = s {
        crate::kill_tree(s.pid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(body: &str) -> Vec<u8> {
        format!("Content-Length: {}\r\n\r\n{body}", body.len()).into_bytes()
    }

    #[test]
    fn frame_zerlegt_nachrichten() {
        let mut b = [msg(r#"{"a":1}"#), msg(r#"{"b":"ä"}"#)].concat();
        assert_eq!(frame(&mut b), Some(Ok(r#"{"a":1}"#.into())));
        assert_eq!(frame(&mut b), Some(Ok(r#"{"b":"ä"}"#.into())));
        assert_eq!(frame(&mut b), None);
        assert!(b.is_empty());
        // Ueber zwei Reads verteilt, mit weiterem Header.
        let full = b"Content-Type: x\r\ncontent-length: 2\r\n\r\n{}".to_vec();
        let mut b = full[..10].to_vec();
        assert_eq!(frame(&mut b), None);
        b.extend_from_slice(&full[10..]);
        assert_eq!(frame(&mut b), Some(Ok("{}".into())));
        let mut b = b"X: 1\r\n\r\n".to_vec();
        assert!(matches!(frame(&mut b), Some(Err(_))));
        assert!(b.is_empty());
    }

    /// Echter Server (clangd, fehlt er: uebersprungen): Start, Framing in beide Richtungen, Diagnostics-Cache, Stopp.
    #[test]
    fn clangd_meldet_fehler() {
        if crate::deps::which("clangd").is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ocui-lsp-clangd-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.canonicalize().unwrap();
        let app = tauri::test::mock_builder().manage(Lsps::default()).build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
        let (tx, rx) = mpsc::channel::<String>();
        let on = Channel::new(move |b| {
            if let tauri::ipc::InvokeResponseBody::Json(j) = b {
                let o: Value = serde_json::from_str(&j).unwrap();
                let _ = tx.send(o["m"].as_str().unwrap_or_default().to_string());
            }
            Ok(())
        });
        let repo = root.to_string_lossy().into_owned();
        start(app.handle().clone(), &repo, "clangd", on).unwrap();
        let send = |m: Value| send(app.handle(), &repo, "clangd".into(), m.to_string()).unwrap();
        let uri = tauri::Url::from_file_path(root.join("a.c")).unwrap().to_string();
        send(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "processId": null, "rootUri": tauri::Url::from_file_path(&root).unwrap().to_string(), "capabilities": {} } }));
        send(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }));
        send(json!({ "jsonrpc": "2.0", "method": "textDocument/didOpen", "params": { "textDocument": { "uri": uri, "languageId": "c", "version": 0, "text": "int main(void) { return x; }\n" } } }));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let mut got_init = false;
        while std::time::Instant::now() < deadline {
            let Ok(m) = rx.recv_timeout(std::time::Duration::from_secs(1)) else { continue };
            got_init |= m.contains(r#""id":1"#) && m.contains("capabilities");
            if m.contains("publishDiagnostics") && m.contains("undeclared") {
                break;
            }
        }
        assert!(got_init);
        let d = app.state::<Lsps>().diagnostics(&repo, Some(&uri));
        assert_eq!(d[0]["diagnostics"][0]["severity"], "Error", "{d}");
        stop(app.handle(), &repo, "clangd".into());
        assert_eq!(app.state::<Lsps>().diagnostics(&repo, None), json!([]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn diagnostics_im_vs_code_format() {
        let dir = std::env::temp_dir().join(format!("ocui-lsp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.canonicalize().unwrap();
        let lsps = Lsps::default();
        let diags = Arc::new(Mutex::new(HashMap::new()));
        let file = tauri::Url::from_file_path(root.join("a b.rs")).unwrap().to_string();
        let pub_ = |list: Value| {
            json!({ "jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": { "uri": file, "diagnostics": list } }).to_string()
        };
        let d = |sev: Option<u64>| json!({ "message": "m", "severity": sev, "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 2 } } });
        remember(&diags, &pub_(json!([d(Some(1)), d(Some(2)), d(Some(3)), d(Some(4)), d(None)])));
        guard(&lsps.0).insert((root.clone(), "rust".into()), Server { pid: 0, tx: mpsc::channel().0, diags: diags.clone() });

        let all = lsps.diagnostics(&root.to_string_lossy(), None);
        let sev: Vec<_> = all[0]["diagnostics"].as_array().unwrap().iter().map(|d| d["severity"].clone()).collect();
        assert_eq!(sev, ["Error", "Warning", "Information", "Hint", "Error"]);
        assert_eq!(all[0]["diagnostics"][0]["range"]["start"]["line"], 1);
        // Andere Kodierung derselben Datei, fremde Datei, fremdes Projekt.
        let other = file.replace("a%20b", "a b");
        assert_eq!(lsps.diagnostics(&root.to_string_lossy(), Some(&other)).as_array().unwrap().len(), 1);
        let foreign = tauri::Url::from_file_path(root.join("x.rs")).unwrap().to_string();
        assert_eq!(lsps.diagnostics(&root.to_string_lossy(), Some(&foreign)), json!([]));
        assert_eq!(lsps.diagnostics(&std::env::temp_dir().to_string_lossy(), None), json!([]));
        // Leere Liste loescht.
        remember(&diags, &pub_(json!([])));
        assert_eq!(lsps.diagnostics(&root.to_string_lossy(), None), json!([]));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
