//! Je Claude-Session zwei lokale Server, beide nur auf 127.0.0.1 und mit Zufallstoken:
//! - IDE-Protokoll von Claude Code (WebSocket-MCP, Lockfile ~/.claude/ide/<port>.lock, CLAUDE_CODE_SSE_PORT):
//!   Edits als Diff zum Annehmen/Ablehnen in der App, Auswahl im Editor als Kontext, @-Erwaehnung,
//!   Diagnostics der Language-Server (src/lsp.rs).
//! - MCP ueber HTTP fuer das Modell (eingebaute Mod, .claude-plugin/plugin.json): git und GitHub/GitLab-API
//!   mit dem Konto aus der App, Datei im Editor zeigen. Token bleiben im Schluesselbund.
//!
//! Protokoll nachgebaut nach der VS-Code-Extension; die CLI ruft openDiff/close_tab/closeAllDiffTabs
//! selbst, getDiagnostics vor/nach Edits und als Tool mcp__ide__getDiagnostics fuers Modell.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::Message;

struct Ctx<R: Runtime> {
    app: AppHandle<R>,
    session: String,
    repo: String,
    token: String,
    // Verbundene Claude-Clients (WebSocket), fuer Notifications aus dem Editor.
    clients: Mutex<Vec<mpsc::UnboundedSender<String>>>,
}

struct Ide<R: Runtime> {
    ctx: Arc<Ctx<R>>,
    lock: PathBuf,
    tasks: [tauri::async_runtime::JoinHandle<()>; 2],
}

impl<R: Runtime> Drop for Ide<R> {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
        let _ = std::fs::remove_file(&self.lock);
        drop_pending(|p| p.session == self.ctx.session);
    }
}

pub struct Ides<R: Runtime = Wry>(Mutex<HashMap<String, Ide<R>>>);

impl<R: Runtime> Default for Ides<R> {
    fn default() -> Self {
        Self(Mutex::default())
    }
}

impl<R: Runtime> Ides<R> {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Ide<R>>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Beim Beenden: Lockfiles weg, sonst listet /ide in anderen Terminals tote Eintraege.
    pub fn close_all(&self) {
        self.lock().clear();
    }

    pub fn stop(&self, session: &str) {
        self.lock().remove(session);
    }

    /// Projekte der laufenden Claude-Sessions (fuer den Wach-Halt, src/awake.rs).
    pub fn repos(&self) -> Vec<String> {
        self.lock().values().map(|i| i.ctx.repo.clone()).collect()
    }
}

/// Offene Diffs: Antwort kommt per ide_reply aus dem Frontend.
struct Pending {
    session: String,
    tab: String,
    reply: oneshot::Sender<Value>,
}

static PENDING: Mutex<Vec<(u64, Pending)>> = Mutex::new(Vec::new());
static NEXT: AtomicU64 = AtomicU64::new(1);

fn pending() -> std::sync::MutexGuard<'static, Vec<(u64, Pending)>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

/// Entfernt passende Diffs; der Sender faellt weg, der wartende openDiff antwortet dann mit Ablehnung.
fn drop_pending(f: impl Fn(&Pending) -> bool) -> usize {
    let mut p = pending();
    let n = p.len();
    p.retain(|(_, x)| !f(x));
    n - p.len()
}

fn token() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| format!("Zufall nicht verfügbar: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// Startet beide Server fuer die Session und liefert die Env-Variablen fuer claude.
pub fn start<R: Runtime>(app: &AppHandle<R>, ides: &Ides<R>, session: &str, repo: &str) -> Result<Vec<(String, String)>, String> {
    let bind = || -> Result<std::net::TcpListener, String> {
        let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("IDE-Server: {e}"))?;
        l.set_nonblocking(true).map_err(|e| e.to_string())?;
        Ok(l)
    };
    let (ws, http) = (bind()?, bind()?);
    let ws_port = ws.local_addr().map_err(|e| e.to_string())?.port();
    let http_port = http.local_addr().map_err(|e| e.to_string())?.port();
    let ctx = Arc::new(Ctx {
        app: app.clone(),
        session: session.into(),
        repo: repo.into(),
        token: token()?,
        clients: Mutex::default(),
    });
    let lock = write_lock(ws_port, &ctx)?;
    let tasks = [
        tauri::async_runtime::spawn(serve(ws, ctx.clone(), true)),
        tauri::async_runtime::spawn(serve(http, ctx.clone(), false)),
    ];
    let env = vec![
        ("CLAUDE_CODE_SSE_PORT".into(), ws_port.to_string()),
        ("OPEN_CLAUDE_MCP_URL".into(), format!("http://127.0.0.1:{http_port}/mcp")),
        ("OPEN_CLAUDE_MCP_TOKEN".into(), ctx.token.clone()),
    ];
    ides.lock().insert(session.into(), Ide { ctx, lock, tasks });
    Ok(env)
}

/// Format wie die VS-Code-Extension; pid = App, damit claude veraltete Dateien selbst aufraeumt.
fn write_lock<R: Runtime>(port: u16, ctx: &Ctx<R>) -> Result<PathBuf, String> {
    let dir = crate::activity::config_dir().join("ide");
    std::fs::create_dir_all(&dir).map_err(|e| format!("IDE-Lockfile: {e}"))?;
    let path = dir.join(format!("{port}.lock"));
    let body = json!({
        "pid": std::process::id(),
        "workspaceFolders": [ctx.repo],
        "ideName": "Open Claude",
        "transport": "ws",
        "runningInWindows": cfg!(windows),
        "authToken": ctx.token,
    });
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    // Token im Klartext: nur fuer den eigenen Nutzer lesbar.
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    use std::io::Write;
    o.open(&path).and_then(|mut f| f.write_all(body.to_string().as_bytes())).map_err(|e| format!("IDE-Lockfile: {e}"))?;
    Ok(path)
}

async fn serve<R: Runtime>(l: std::net::TcpListener, ctx: Arc<Ctx<R>>, ws: bool) {
    let Ok(l) = TcpListener::from_std(l) else { return };
    while let Ok((s, _)) = l.accept().await {
        let ctx = ctx.clone();
        tauri::async_runtime::spawn(async move {
            if ws {
                ws_conn(s, ctx).await;
            } else {
                let _ = http_conn(s, ctx).await;
            }
        });
    }
}

// ---------- WebSocket (IDE) ----------

// ErrorResponse gibt tungstenite vor.
#[allow(clippy::result_large_err)]
async fn ws_conn<R: Runtime>(s: TcpStream, ctx: Arc<Ctx<R>>) {
    let check = |req: &Request, mut res: Response| -> Result<Response, ErrorResponse> {
        let auth = req.headers().get("x-claude-code-ide-authorization").and_then(|v| v.to_str().ok());
        if auth != Some(ctx.token.as_str()) {
            let mut e = ErrorResponse::new(Some("Unauthorized".into()));
            *e.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
            return Err(e);
        }
        let proto = req.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()).unwrap_or("");
        if proto.split(',').any(|p| p.trim() == "mcp") {
            res.headers_mut().insert("sec-websocket-protocol", "mcp".parse().expect("gueltiger Header"));
        }
        Ok(res)
    };
    let Ok(ws) = tokio_tungstenite::accept_hdr_async(s, check).await else { return };
    let (mut sink, mut src) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    // Wie VS Code: immer nur ein Client, der neue loest den alten ab.
    *ctx.clients.lock().unwrap_or_else(|e| e.into_inner()) = vec![tx.clone()];
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(Message::Text(m.into())).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(m)) = src.next().await {
        let Message::Text(t) = m else { continue };
        let Ok(msg) = serde_json::from_str::<Value>(&t) else { continue };
        // openDiff blockiert bis zur Entscheidung: jede Anfrage eigenstaendig beantworten.
        let (ctx, tx) = (ctx.clone(), tx.clone());
        tauri::async_runtime::spawn(async move {
            if let Some(r) = rpc(&ctx, &msg, true).await {
                let _ = tx.send(r.to_string());
            }
        });
    }
    writer.abort();
}

/// Notification aus dem Editor an die Claude-Sessions dieses Repos (Auswahl, @-Erwaehnung).
#[tauri::command]
pub fn ide_notify(ides: tauri::State<'_, Ides>, repo: String, method: String, params: Value) -> Result<(), String> {
    if method != "selection_changed" && method != "at_mentioned" {
        return Err(format!("Unbekannte Notification: {method}"));
    }
    let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string();
    for ide in ides.lock().values().filter(|i| i.ctx.repo == repo) {
        for c in ide.ctx.clients.lock().unwrap_or_else(|e| e.into_inner()).iter() {
            let _ = c.send(msg.clone());
        }
    }
    Ok(())
}

/// Entscheidung zu einem Diff: accept mit (ggf. bearbeitetem) Inhalt, sonst abgelehnt.
#[tauri::command]
pub fn ide_reply(id: u64, accept: bool, content: Option<String>) {
    let mut p = pending();
    if let Some(i) = p.iter().position(|(k, _)| *k == id) {
        let (_, x) = p.remove(i);
        let _ = x.reply.send(json!({ "accept": accept, "content": content }));
    }
}

// ---------- HTTP (MCP fuers Modell) ----------

/// Minimaler Streamable-HTTP-Server: ein POST je Verbindung, JSON-Antwort, keine Sessions.
async fn http_conn<R: Runtime>(mut s: TcpStream, ctx: Arc<Ctx<R>>) -> std::io::Result<()> {
    const MAX: usize = 8 << 20;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        let n = s.read(&mut chunk).await?;
        if n == 0 || buf.len() > 64 << 10 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let method = lines.next().and_then(|l| l.split(' ').next()).unwrap_or("").to_string();
    let headers: HashMap<String, String> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let respond = |code: &str, body: &str| {
        let ty = if body.is_empty() { "" } else { "Content-Type: application/json\r\n" };
        format!("HTTP/1.1 {code}\r\n{ty}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    };
    if headers.get("authorization").map(String::as_str) != Some(&format!("Bearer {}", ctx.token)) {
        return s.write_all(respond("401 Unauthorized", "").as_bytes()).await;
    }
    if method != "POST" {
        return s.write_all(respond("405 Method Not Allowed", "").as_bytes()).await;
    }
    let len: usize = headers.get("content-length").and_then(|l| l.parse().ok()).unwrap_or(0);
    if len > MAX {
        return s.write_all(respond("413 Payload Too Large", "").as_bytes()).await;
    }
    let mut body = buf[head_end..].to_vec();
    while body.len() < len {
        let n = s.read(&mut chunk).await?;
        if n == 0 {
            return Ok(());
        }
        body.extend_from_slice(&chunk[..n]);
    }
    let Ok(msg) = serde_json::from_slice::<Value>(&body[..len.min(body.len())]) else {
        return s.write_all(respond("400 Bad Request", "").as_bytes()).await;
    };
    let out = match rpc(&ctx, &msg, false).await {
        Some(r) => respond("200 OK", &r.to_string()),
        None => respond("202 Accepted", ""),
    };
    s.write_all(out.as_bytes()).await
}

// ---------- JSON-RPC / MCP ----------

/// None bei Notifications (ohne id).
async fn rpc<R: Runtime>(ctx: &Ctx<R>, msg: &Value, ide: bool) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let params = &msg["params"];
    let res = match msg["method"].as_str().unwrap_or("") {
        "initialize" => Ok(json!({
            "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "open-claude", "version": env!("CARGO_PKG_VERSION") },
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": if ide { ide_tools() } else { tools(ctx) } })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        "resources/list" => Ok(json!({ "resources": [] })),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or("");
            let args = &params["arguments"];
            let out = if ide { ide_call(ctx, name, args).await } else { call(ctx, name, args).await };
            Ok(match out {
                Ok(content) => json!({ "content": content }),
                Err(e) => json!({ "content": [text(&e)], "isError": true }),
            })
        }
        m => Err(json!({ "code": -32601, "message": format!("Methode unbekannt: {m}") })),
    };
    Some(match res {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
    })
}

fn text(s: &str) -> Value {
    json!({ "type": "text", "text": s })
}

fn ide_tools() -> Value {
    let s = |props: Value, req: &[&str]| json!({ "type": "object", "properties": props, "required": req });
    let st = json!({ "type": "string" });
    json!([
        { "name": "openDiff", "description": "Diff zum Annehmen/Ablehnen zeigen", "inputSchema": s(json!({
            "old_file_path": st, "new_file_path": st, "new_file_contents": st, "tab_name": st,
        }), &["old_file_path", "new_file_path", "new_file_contents", "tab_name"]) },
        { "name": "close_tab", "description": "Diff schliessen", "inputSchema": s(json!({ "tab_name": st }), &["tab_name"]) },
        { "name": "closeAllDiffTabs", "description": "Alle Diffs schliessen", "inputSchema": s(json!({}), &[]) },
        { "name": "getDiagnostics", "description": "Fehler und Warnungen der Language-Server im Editor von Open Claude \
            (nur Projekte mit freigeschalteten Language-Servern; manche Server melden nur für im Editor geöffnete Dateien). \
            Ohne uri alle Dateien.", "inputSchema": s(json!({ "uri": { "type": "string", "description": "file://-URI einer Datei" } }), &[]) },
    ])
}

async fn ide_call<R: Runtime>(ctx: &Ctx<R>, name: &str, a: &Value) -> Result<Vec<Value>, String> {
    let arg = |k: &str| a[k].as_str().unwrap_or("").to_string();
    match name {
        "openDiff" => {
            let (tab, (tx, rx)) = (arg("tab_name"), oneshot::channel());
            let id = NEXT.fetch_add(1, Ordering::Relaxed);
            pending().push((id, Pending { session: ctx.session.clone(), tab: tab.clone(), reply: tx }));
            let ev = json!({ "id": id, "repo": ctx.repo, "path": arg("new_file_path"), "content": arg("new_file_contents") });
            ctx.app.emit("ide-diff", ev).map_err(|e| e.to_string())?;
            // Weggefallen (close_tab, Session zu) = abgelehnt. TAB_CLOSED hiesse fuer claude "angenommen".
            let r = rx.await.unwrap_or(Value::Null);
            Ok(match r["content"].as_str() {
                Some(c) if r["accept"] == true => vec![text("FILE_SAVED"), text(c)],
                _ => vec![text("DIFF_REJECTED"), text(&tab)],
            })
        }
        "close_tab" => {
            let tab = arg("tab_name");
            close(ctx, |p| p.tab == tab);
            Ok(vec![text("TAB_CLOSED")])
        }
        "getDiagnostics" => {
            let uri = a["uri"].as_str().filter(|u| !u.is_empty());
            let d = ctx.app.try_state::<crate::lsp::Lsps>().map_or(json!([]), |l| l.diagnostics(&ctx.repo, uri));
            Ok(vec![text(&d.to_string())])
        }
        "closeAllDiffTabs" => {
            let n = close(ctx, |_| true);
            Ok(vec![text(&format!("CLOSED_{n}_DIFF_TABS"))])
        }
        _ => Err(format!("Tool unbekannt: {name}")),
    }
}

fn close<R: Runtime>(ctx: &Ctx<R>, f: impl Fn(&Pending) -> bool) -> usize {
    let ids: Vec<u64> = pending().iter().filter(|(_, p)| p.session == ctx.session && f(p)).map(|(k, _)| *k).collect();
    let n = drop_pending(|p| p.session == ctx.session && f(p));
    let _ = ctx.app.emit("ide-close", ids);
    n
}

fn tools<R: Runtime>(ctx: &Ctx<R>) -> Value {
    let target = match crate::forge::mcp_target(&ctx.app, &ctx.repo) {
        Ok((kind, host, base)) => {
            let name = if kind == "github" { "GitHub REST API" } else { "GitLab REST API v4" };
            format!("{name} auf {host}, angemeldet über Open Claude. Dieses Repository: {base}")
        }
        Err(e) => format!("Derzeit nicht nutzbar: {e}. Konto in Open Claude unter „Konten“ anmelden"),
    };
    let obj = |props: Value, req: &[&str]| json!({ "type": "object", "properties": props, "required": req });
    let path = json!({ "type": "string", "description": "API-Pfad ab der API-Wurzel, z. B. /repos/o/r/pulls bzw. /projects/<id>/merge_requests" });
    let query = json!({ "type": "object", "description": "Query-Parameter", "additionalProperties": { "type": ["string", "number", "boolean"] } });
    json!([
        {
            "name": "git",
            "description": "git im Repository der Session ausführen, mit dem in Open Claude gebundenen Konto authentifiziert \
                (push/pull/fetch ohne gh-Login oder Credential-Helper). Lokale Befehle gehen auch über Bash.",
            "inputSchema": obj(json!({ "args": { "type": "array", "items": { "type": "string" }, "description": "Argumente ohne \"git\", z. B. [\"push\", \"-u\", \"origin\", \"feature\"]" } }), &["args"]),
        },
        {
            "name": "forge_read",
            "description": format!("GET-Anfrage an die GitHub-/GitLab-API des Repositorys. {target}. Für PRs/MRs, Issues, Reviews, Kommentare, CI-Runs, Job-Logs, Releases. \
                accept z. B. application/vnd.github.diff für PR-Diffs."),
            "inputSchema": obj(json!({ "path": path, "query": query, "accept": { "type": "string" } }), &["path"]),
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "forge_write",
            "description": format!("Schreibende Anfrage an die GitHub-/GitLab-API des Repositorys. {target}. Z. B. PR/MR anlegen, kommentieren, mergen, Issue anlegen, CI neu starten."),
            "inputSchema": obj(json!({
                "method": { "type": "string", "enum": ["POST", "PATCH", "PUT", "DELETE"] },
                "path": path,
                "query": query,
                "body": { "type": "object", "description": "JSON-Body" },
            }), &["method", "path"]),
            "annotations": { "destructiveHint": true },
        },
        {
            "name": "open_file",
            "description": "Datei im Editor von Open Claude öffnen und dem Nutzer zeigen, optional an einer Zeile.",
            "inputSchema": obj(json!({ "path": { "type": "string", "description": "absolut oder relativ zum Repository" }, "line": { "type": "integer", "description": "1-basiert" } }), &["path"]),
        },
        {
            "name": "clean_images",
            "description": "Eingefügte Bilder aus Claude-Transkripten entfernen (Platzhalter statt base64), um Speicherplatz freizugeben. \
                Laufende Sitzungen bleiben unangetastet. Nur auf ausdrücklichen Wunsch des Nutzers (sonst /clean-images).",
            "inputSchema": obj(json!({
                "args": { "type": "string", "description": "alle (Standard), 1d oder 7d (nur älter als), optional plus hier" },
                "session": { "type": "string", "description": "Sitzungs-ID für hier" },
            }), &[]),
            "annotations": { "destructiveHint": true },
        },
    ])
}

async fn call<R: Runtime>(ctx: &Ctx<R>, name: &str, a: &Value) -> Result<Vec<Value>, String> {
    let query: Vec<(String, String)> = a["query"]
        .as_object()
        .map(|q| q.iter().map(|(k, v)| (k.clone(), v.as_str().map_or_else(|| v.to_string(), String::from))).collect())
        .unwrap_or_default();
    let path = a["path"].as_str().unwrap_or("");
    let out = match name {
        "git" => {
            let args: Vec<String> = a["args"].as_array().ok_or("args fehlt")?.iter().filter_map(|x| x.as_str().map(String::from)).collect();
            let repo = ctx.repo.clone();
            crate::git::blocking(move || {
                let o = crate::git::exec(crate::git::net(&repo).args(&args), None)?;
                let mut out = String::from_utf8_lossy(&o.stdout).into_owned();
                out.push_str(&String::from_utf8_lossy(&o.stderr));
                if o.status.success() { Ok(out) } else { Err(format!("git beendet mit {}\n{out}", o.status)) }
            })
            .await?
        }
        "forge_read" => crate::forge::mcp_call(&ctx.app, &ctx.repo, "GET", path, &query, None, a["accept"].as_str()).await?,
        "forge_write" => {
            let m = a["method"].as_str().unwrap_or("");
            if !["POST", "PATCH", "PUT", "DELETE"].contains(&m) {
                return Err(format!("Methode nicht erlaubt: {m}"));
            }
            let body = a.get("body").filter(|b| !b.is_null());
            crate::forge::mcp_call(&ctx.app, &ctx.repo, m, path, &query, body, None).await?
        }
        "open_file" => {
            let ev = json!({ "repo": ctx.repo, "path": path, "line": a["line"].as_u64() });
            ctx.app.emit("ide-open", ev).map_err(|e| e.to_string())?;
            format!("Geöffnet: {path}")
        }
        "clean_images" => {
            let (days, here) = crate::images::parse(a["args"].as_str().unwrap_or(""))?;
            let sid = here.then(|| a["session"].as_str().unwrap_or("").to_string()).filter(|s| !s.is_empty());
            let r = crate::git::blocking(move || Ok(crate::images::clean(&crate::activity::config_dir(), days, sid.as_deref()))).await?;
            crate::images::summary(&r)
        }
        _ => return Err(format!("Tool unbekannt: {name}")),
    };
    Ok(vec![text(&clip(&out))])
}

/// Logs und grosse Listen kuerzen: Anfang und Ende bleiben (Fehler stehen bei Logs meist am Ende).
fn clip(s: &str) -> String {
    const HALF: usize = 40_000;
    if s.len() <= 2 * HALF {
        return s.to_string();
    }
    let head = s.floor_char_boundary(HALF);
    let tail = s.ceil_char_boundary(s.len() - HALF);
    format!("{}\n… {} Zeichen gekürzt …\n{}", &s[..head], tail - head, &s[tail..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_behaelt_anfang_und_ende() {
        assert_eq!(clip("kurz"), "kurz");
        let s = format!("A{}Z", "ä".repeat(60_000));
        let c = clip(&s);
        assert!(c.starts_with('A') && c.ends_with('Z') && c.contains("gekürzt") && c.len() < 90_000);
    }

    async fn post(port: &str, auth: &str, body: Value) -> String {
        let body = body.to_string();
        let mut s = TcpStream::connect(format!("127.0.0.1:{port}")).await.unwrap();
        let req = format!("POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: {auth}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        s.write_all(req.as_bytes()).await.unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        out
    }

    fn call(id: u64, name: &str, args: Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": name, "arguments": args } })
    }

    /// Beide Server ueber echte Sockets: Auth, MCP-Handshake, git-Tool, openDiff annehmen und per close_tab ablehnen.
    #[test]
    fn server_sprechen_mcp() {
        use tauri::Listener;
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let app = tauri::test::mock_app();
        let repo = std::env::temp_dir().join(format!("ocui-ide-{}", std::process::id()));
        std::fs::create_dir_all(&repo).unwrap();
        assert!(crate::git::exec(std::process::Command::new("git").arg("-C").arg(&repo).arg("init"), None).unwrap().status.success());
        let repo_s = repo.to_string_lossy().into_owned();
        let ides = Ides::default();
        let env: HashMap<_, _> = start(app.handle(), &ides, "t1", &repo_s).unwrap().into_iter().collect();
        let ws_port = env["CLAUDE_CODE_SSE_PORT"].clone();
        let http_port = env["OPEN_CLAUDE_MCP_URL"].trim_start_matches("http://127.0.0.1:").trim_end_matches("/mcp").to_string();
        let tok = env["OPEN_CLAUDE_MCP_TOKEN"].clone();
        let lock = crate::activity::config_dir().join("ide").join(format!("{ws_port}.lock"));
        let l: Value = serde_json::from_str(&std::fs::read_to_string(&lock).unwrap()).unwrap();
        assert_eq!((l["authToken"].as_str(), l["transport"].as_str()), (Some(tok.as_str()), Some("ws")));

        // Frontend-Ersatz: jeden Diff mit dem vorgeschlagenen Inhalt annehmen.
        app.listen_any("ide-diff", |e| {
            let p: Value = serde_json::from_str(e.payload()).unwrap();
            if p["content"] == "neu" {
                ide_reply(p["id"].as_u64().unwrap(), true, Some("neu".into()));
            }
        });

        tauri::async_runtime::block_on(async {
            let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } });
            assert!(post(&http_port, "Bearer falsch", init.clone()).await.starts_with("HTTP/1.1 401"));
            assert!(post(&http_port, &format!("Bearer {tok}"), init).await.contains("\"protocolVersion\":\"2025-06-18\""));
            let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
            assert!(post(&http_port, &format!("Bearer {tok}"), note).await.starts_with("HTTP/1.1 202"));
            let list = post(&http_port, &format!("Bearer {tok}"), json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).await;
            assert!(list.contains("\"forge_write\"") && list.contains("hat kein Remote"), "{list}");
            let st = post(&http_port, &format!("Bearer {tok}"), call(3, "git", json!({ "args": ["status"] }))).await;
            assert!(st.contains("No commits yet"), "{st}");

            let mut bad = format!("ws://127.0.0.1:{ws_port}").into_client_request().unwrap();
            bad.headers_mut().insert("x-claude-code-ide-authorization", "falsch".parse().unwrap());
            assert!(tokio_tungstenite::connect_async(bad).await.is_err());
            let mut req = format!("ws://127.0.0.1:{ws_port}").into_client_request().unwrap();
            req.headers_mut().insert("x-claude-code-ide-authorization", tok.parse().unwrap());
            req.headers_mut().insert("sec-websocket-protocol", "mcp".parse().unwrap());
            let (mut ws, res) = tokio_tungstenite::connect_async(req).await.unwrap();
            assert_eq!(res.headers()["sec-websocket-protocol"], "mcp");
            let mut ask = async |m: Value| {
                ws.send(Message::Text(m.to_string().into())).await.unwrap();
                loop {
                    if let Some(Ok(Message::Text(t))) = ws.next().await {
                        break serde_json::from_str::<Value>(&t).unwrap();
                    }
                }
            };
            let tools = ask(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })).await;
            assert_eq!(tools["result"]["tools"][0]["name"], "openDiff");
            assert!(tools.to_string().contains("getDiagnostics"));
            let d = ask(call(9, "getDiagnostics", json!({}))).await;
            assert_eq!(d["result"]["content"], json!([text("[]")]));
            let diff = |id, content| call(id, "openDiff", json!({ "old_file_path": "/x", "new_file_path": "/x", "new_file_contents": content, "tab_name": "T" }));
            let r = ask(diff(2, "neu")).await;
            assert_eq!(r["result"]["content"], json!([text("FILE_SAVED"), text("neu")]));

            // Bleibt offen, bis claude den Tab schliesst: dann abgelehnt.
            let ctx = ides.lock()["t1"].ctx.clone();
            let open = tauri::async_runtime::spawn(async move { ide_call(&ctx, "openDiff", &diff(0, "anders")["params"]["arguments"]).await });
            while pending().is_empty() {
                tokio::task::yield_now().await;
            }
            let r = ask(call(3, "close_tab", json!({ "tab_name": "T" }))).await;
            assert_eq!(r["result"]["content"], json!([text("TAB_CLOSED")]));
            assert_eq!(open.await.unwrap().unwrap(), vec![text("DIFF_REJECTED"), text("T")]);
        });

        ides.stop("t1");
        assert!(!lock.exists());
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn token_zufaellig_und_hex() {
        let (a, b) = (token().unwrap(), token().unwrap());
        assert_ne!(a, b);
        assert!(a.len() == 32 && a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}

