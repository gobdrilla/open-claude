//! Je Claude-Session zwei lokale Server, beide nur auf 127.0.0.1 und mit Zufallstoken:
//! - IDE-Protokoll von Claude Code (WebSocket-MCP, Lockfile ~/.claude/ide/<port>.lock, CLAUDE_CODE_SSE_PORT):
//!   Edits als Diff zum Annehmen/Ablehnen in der App, Auswahl im Editor als Kontext, @-Erwaehnung,
//!   Diagnostics der Language-Server (src/lsp.rs).
//! - MCP ueber HTTP fuer das Modell (eingebaute Mod, .claude-plugin/plugin.json): git und GitHub/GitLab-API
//!   mit dem Konto aus der App, Datei im Editor zeigen, Language-Server, Debugger und Run-Panel des Editors
//!   (lsp/debugger/run, ausgefuehrt im Frontend: agent.svelte.ts). Token bleiben im Schluesselbund.
//!
//! Protokoll nachgebaut nach der VS-Code-Extension; die CLI ruft openDiff/close_tab/closeAllDiffTabs
//! selbst, getDiagnostics vor/nach Edits und als Tool mcp__ide__getDiagnostics fuers Modell.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

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
    getrandom::fill(&mut b).map_err(|e| tr!("Zufall nicht verfügbar: {e}", "Randomness not available: {e}"))?;
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
        "ideName": "L'Atelier de Claude",
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
/// true = mindestens ein Client hat sie bekommen; sonst faellt das Frontend auf Einfuegen ins Terminal zurueck.
#[tauri::command]
pub fn ide_notify(ides: tauri::State<'_, Ides>, repo: String, method: String, params: Value) -> Result<bool, String> {
    ides.notify(&repo, &method, params)
}

impl<R: Runtime> Ides<R> {
    fn notify(&self, repo: &str, method: &str, params: Value) -> Result<bool, String> {
        if method != "selection_changed" && method != "at_mentioned" {
            return Err(tr!("Unbekannte Notification: {method}", "Unknown notification: {method}"));
        }
        let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string();
        let mut sent = false;
        for ide in self.lock().values().filter(|i| i.ctx.repo == repo) {
            for c in ide.ctx.clients.lock().unwrap_or_else(|e| e.into_inner()).iter() {
                sent |= c.send(msg.clone()).is_ok();
            }
        }
        Ok(sent)
    }
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

/// Letzter Editor-Stand je Projekt (offene Dateien, aktive Datei, Auswahl; ohne Pufferinhalt) fuer das Tool editor_state.
static EDITORS: LazyLock<Mutex<HashMap<String, Value>>> = LazyLock::new(Default::default);

fn editors() -> std::sync::MutexGuard<'static, HashMap<String, Value>> {
    EDITORS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Vom Frontend (ide.svelte.ts pushEditor); null = Editor geschlossen.
#[tauri::command]
pub fn ide_editor_state(repo: String, state: Value) {
    if state.is_null() {
        editors().remove(&repo);
    } else {
        editors().insert(repo, state);
    }
}

/// Letzte Run-Ausgabe + rote Tests je Projekt fuer das Tool run_state; Text, weil das Frontend ihn fertig formatiert.
static RUNS: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);

fn runs() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    RUNS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Vom Frontend (run.svelte.ts pushRunState); None = nichts mehr zu zeigen.
#[tauri::command]
pub fn ide_run_state(repo: String, state: Option<String>) {
    match state {
        Some(s) => runs().insert(repo, s),
        None => runs().remove(&repo),
    };
}

/// Editor tools (lsp, debugger, run) run in the frontend: request out per event "ide-ask", answer via ide_answer.
type Answer = oneshot::Sender<Result<String, String>>;
static ASKS: Mutex<Vec<(u64, Answer)>> = Mutex::new(Vec::new());

fn asks() -> std::sync::MutexGuard<'static, Vec<(u64, Answer)>> {
    ASKS.lock().unwrap_or_else(|e| e.into_inner())
}

/// From the frontend (agent.svelte.ts): result of an editor tool.
#[tauri::command]
pub fn ide_answer(id: u64, ok: bool, text: String) {
    let mut a = asks();
    if let Some(i) = a.iter().position(|(k, _)| *k == id) {
        let _ = a.remove(i).1.send(if ok { Ok(text) } else { Err(text) });
    }
}

async fn ask<R: Runtime>(ctx: &Ctx<R>, tool: &str, args: &Value) -> Result<String, String> {
    let (tx, rx) = oneshot::channel();
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    asks().push((id, tx));
    let sent = ctx.app.emit("ide-ask", json!({ "id": id, "repo": ctx.repo, "tool": tool, "args": args }));
    // Debugger start builds the project and may ask the user (missing SDK): generous, but never forever.
    let r = match sent {
        Ok(()) => tokio::time::timeout(std::time::Duration::from_secs(300), rx).await.ok().and_then(Result::ok),
        Err(_) => None,
    };
    asks().retain(|(k, _)| *k != id);
    r.unwrap_or_else(|| Err(tr!("Keine Antwort vom Editor von L'Atelier de Claude.", "No answer from the L'Atelier de Claude editor.")))
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
            "serverInfo": { "name": "atelier", "version": env!("CARGO_PKG_VERSION") },
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
        m => Err(json!({ "code": -32601, "message": tr!("Methode unbekannt: {m}", "Unknown method: {m}") })),
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
        { "name": "openDiff", "description": tr!("Diff zum Annehmen/Ablehnen zeigen", "Show a diff to accept/reject"), "inputSchema": s(json!({
            "old_file_path": st, "new_file_path": st, "new_file_contents": st, "tab_name": st,
        }), &["old_file_path", "new_file_path", "new_file_contents", "tab_name"]) },
        { "name": "close_tab", "description": tr!("Diff schliessen", "Close diff"), "inputSchema": s(json!({ "tab_name": st }), &["tab_name"]) },
        { "name": "closeAllDiffTabs", "description": tr!("Alle Diffs schliessen", "Close all diffs"), "inputSchema": s(json!({}), &[]) },
        { "name": "getDiagnostics", "description": tr!("Fehler und Warnungen der Language-Server im Editor von L'Atelier de Claude \
            (nur Projekte mit freigeschalteten Language-Servern; manche Server melden nur für im Editor geöffnete Dateien). \
            Ohne uri alle Dateien.", "Errors and warnings of the language servers in the L'Atelier de Claude editor \
            (only projects with enabled language servers; some servers only report files open in the editor). \
            Without uri all files."), "inputSchema": s(json!({ "uri": { "type": "string", "description": tr!("file://-URI einer Datei", "file:// URI of a file") } }), &[]) },
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
        _ => Err(tr!("Tool unbekannt: {name}", "Unknown tool: {name}")),
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
            tr!("{name} auf {host}, angemeldet über L'Atelier de Claude. Dieses Repository: {base}", "{name} on {host}, signed in via L'Atelier de Claude. This repository: {base}")
        }
        Err(e) => tr!("Derzeit nicht nutzbar: {e}. Konto in L'Atelier de Claude unter „Konten“ anmelden", "Currently unavailable: {e}. Sign in to an account in L'Atelier de Claude under “Accounts”"),
    };
    let obj = |props: Value, req: &[&str]| json!({ "type": "object", "properties": props, "required": req });
    let path = json!({ "type": "string", "description": tr!("API-Pfad ab der API-Wurzel, z. B. /repos/o/r/pulls bzw. /projects/<id>/merge_requests", "API path from the API root, e.g. /repos/o/r/pulls or /projects/<id>/merge_requests") });
    let query = json!({ "type": "object", "description": tr!("Query-Parameter", "Query parameters"), "additionalProperties": { "type": ["string", "number", "boolean"] } });
    json!([
        {
            "name": "git",
            "description": tr!("git im Repository der Session ausführen, mit dem in L'Atelier de Claude gebundenen Konto authentifiziert \
                (push/pull/fetch ohne gh-Login oder Credential-Helper). Lokale Befehle gehen auch über Bash.",
                "Run git in the session's repository, authenticated with the account bound in L'Atelier de Claude \
                (push/pull/fetch without gh login or credential helper). Local commands also work via Bash."),
            "inputSchema": obj(json!({ "args": { "type": "array", "items": { "type": "string" }, "description": tr!("Argumente ohne \"git\", z. B. [\"push\", \"-u\", \"origin\", \"feature\"]", "Arguments without \"git\", e.g. [\"push\", \"-u\", \"origin\", \"feature\"]") } }), &["args"]),
        },
        {
            "name": "forge_read",
            "description": tr!("GET-Anfrage an die GitHub-/GitLab-API des Repositorys. {target}. Für PRs/MRs, Issues, Reviews, Kommentare, CI-Runs, Job-Logs, Releases. \
                accept z. B. application/vnd.github.diff für PR-Diffs.",
                "GET request to the repository's GitHub/GitLab API. {target}. For PRs/MRs, issues, reviews, comments, CI runs, job logs, releases. \
                accept e.g. application/vnd.github.diff for PR diffs."),
            "inputSchema": obj(json!({ "path": path, "query": query, "accept": { "type": "string" } }), &["path"]),
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "forge_write",
            "description": tr!("Schreibende Anfrage an die GitHub-/GitLab-API des Repositorys. {target}. Z. B. PR/MR anlegen, kommentieren, mergen, Issue anlegen, CI neu starten.", "Write request to the repository's GitHub/GitLab API. {target}. E.g. create, comment on or merge a PR/MR, create an issue, restart CI."),
            "inputSchema": obj(json!({
                "method": { "type": "string", "enum": ["POST", "PATCH", "PUT", "DELETE"] },
                "path": path,
                "query": query,
                "body": { "type": "object", "description": tr!("JSON-Body", "JSON body") },
            }), &["method", "path"]),
            "annotations": { "destructiveHint": true },
        },
        {
            "name": "open_file",
            "description": tr!("Datei im Editor von L'Atelier de Claude öffnen und dem Nutzer zeigen, optional an einer Zeile.", "Open a file in the L'Atelier de Claude editor and show it to the user, optionally at a line."),
            "inputSchema": obj(json!({ "path": { "type": "string", "description": tr!("absolut oder relativ zum Repository", "absolute or relative to the repository") }, "line": { "type": "integer", "description": tr!("1-basiert", "1-based") } }), &["path"]),
        },
        {
            "name": "clean_images",
            "description": tr!("Eingefügte Bilder aus Claude-Transkripten entfernen (Platzhalter statt base64), um Speicherplatz freizugeben. \
                Laufende Sitzungen bleiben unangetastet. Nur auf ausdrücklichen Wunsch des Nutzers (sonst /clean-images).",
                "Remove pasted images from Claude transcripts (placeholder instead of base64) to free disk space. \
                Running sessions stay untouched. Only when the user explicitly asks (otherwise /clean-images)."),
            "inputSchema": obj(json!({
                "args": { "type": "string", "description": tr!("alle (Standard), 1d oder 7d (nur älter als), optional plus hier", "all (default), 1d or 7d (only older than), optionally plus here") },
                "session": { "type": "string", "description": tr!("Sitzungs-ID für hier", "Session ID for here") },
            }), &[]),
            "annotations": { "destructiveHint": true },
        },
        {
            "name": "lsp",
            "description": tr!("Language-Server des Editors von L'Atelier de Claude (dieselben wie im Editor; das Projekt muss sie dort erlaubt haben). \
                Lesend: definition, type_definition, implementation, references, hover (Typ und Doku), document_symbols, workspace_symbols (query), \
                code_actions (Quick-Fixes und Refactorings an der Stelle bzw. den Zeilen line..end_line). \
                Schreibend, Ergebnis gespeichert: rename (new_name, über alle Dateien), apply_code_action (title aus code_actions), format. \
                Stelle: path + line (1-basiert) + symbol (Text in der Zeile) oder column (1-basiert).",
                "Language servers of the L'Atelier de Claude editor (the same as in the editor; the project must have allowed them there). \
                Read: definition, type_definition, implementation, references, hover (type and docs), document_symbols, workspace_symbols (query), \
                code_actions (quick fixes and refactorings at the position or lines line..end_line). \
                Write, result saved: rename (new_name, across all files), apply_code_action (title from code_actions), format. \
                Position: path + line (1-based) + symbol (text in that line) or column (1-based)."),
            "inputSchema": obj(json!({
                "operation": { "type": "string", "enum": ["definition", "type_definition", "implementation", "references", "hover", "document_symbols", "workspace_symbols", "code_actions", "rename", "apply_code_action", "format"] },
                "path": { "type": "string", "description": tr!("absolut oder relativ zum Repository", "absolute or relative to the repository") },
                "line": { "type": "integer", "description": tr!("1-basiert", "1-based") },
                "end_line": { "type": "integer", "description": tr!("code_actions: letzte Zeile des Bereichs", "code_actions: last line of the range") },
                "symbol": { "type": "string", "description": tr!("Bezeichner in der Zeile; die Stelle ist sein erstes Vorkommen", "identifier in the line; the position is its first occurrence") },
                "column": { "type": "integer", "description": tr!("1-basiert, statt symbol", "1-based, instead of symbol") },
                "query": { "type": "string" },
                "new_name": { "type": "string" },
                "title": { "type": "string" },
            }), &["operation"]),
        },
        {
            "name": "debugger",
            "description": tr!("Debugger des Editors von L'Atelier de Claude (bisher .NET über netcoredbg). Startet und steuert Projektcode. \
                breakpoints (path + lines setzt die Zeilen der Datei, leer entfernt; ohne path Liste), start (config = Startziel aus run list, sonst das gewählte), \
                continue/next/step_in/step_out (warten bis zum nächsten Halt), pause, stop, state (Halt, Stack, Variablen, Ausgabe), \
                variables (ref aus state), evaluate (expression im gewählten Frame).",
                "Debugger of the L'Atelier de Claude editor (so far .NET via netcoredbg). Starts and controls project code. \
                breakpoints (path + lines sets the file's lines, empty removes; without path lists), start (config = run target from run list, else the selected one), \
                continue/next/step_in/step_out (wait for the next stop), pause, stop, state (stop, stack, variables, output), \
                variables (ref from state), evaluate (expression in the selected frame)."),
            "inputSchema": obj(json!({
                "action": { "type": "string", "enum": ["breakpoints", "start", "continue", "next", "step_in", "step_out", "pause", "stop", "state", "variables", "evaluate"] },
                "path": { "type": "string" },
                "lines": { "type": "array", "items": { "type": "integer" } },
                "config": { "type": "string" },
                "ref": { "type": "integer" },
                "expression": { "type": "string" },
            }), &["action"]),
            "annotations": { "destructiveHint": true },
        },
        {
            "name": "run",
            "description": tr!("Startziele des Run-Panels von L'Atelier de Claude (package.json-Scripts, .NET-Projekte, Cargo, eigene). \
                list, start/restart/stop (config = Label aus list, sonst das gewählte), output (letzte Zeilen; auch run_state). Startet Projektcode.",
                "Run targets of the L'Atelier de Claude run panel (package.json scripts, .NET projects, Cargo, custom). \
                list, start/restart/stop (config = label from list, else the selected one), output (latest lines; also run_state). Starts project code."),
            "inputSchema": obj(json!({
                "action": { "type": "string", "enum": ["list", "start", "restart", "stop", "output"] },
                "config": { "type": "string" },
            }), &["action"]),
            "annotations": { "destructiveHint": true },
        },
        {
            "name": "editor_state",
            "description": tr!("Offene Dateien im Editor (dirty/conflict), aktive Datei und Auswahl. Bei Fragen zur offenen Datei/Auswahl aufrufen; \
                vor Edits prüfen, ob die Datei ungespeichert ist.",
                "Open files in the editor (dirty/conflict), active file and selection. Call for questions about the open file/selection; \
                before edits check whether the file is unsaved."),
            "inputSchema": obj(json!({}), &[]),
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "run_state",
            "description": tr!("Letzte Ausgabe des Run-Panels (Befehl, Status, exit, 200 Zeilen ohne ANSI) und fehlgeschlagene Tests. \
                Vor dem Fragen nach Logs oder Testfehlern aufrufen.",
                "Latest output of the run panel (command, status, exit, 200 lines without ANSI) and failed tests. \
                Call before asking for logs or test failures."),
            "inputSchema": obj(json!({}), &[]),
            "annotations": { "readOnlyHint": true },
        },
    ])
}

/// Konto-Auth nur fuers Session-Repo: keine globalen Optionen (-C, -c, --git-dir ...) und kein eigener Pack-Befehl.
// shortcut: Hooks und Repo-Config laufen weiter mit Auth-Env, wer per Bash Hooks schreibt, kommt an den Token; erst mit Credential-Helper statt Env dicht.
fn git_args_ok(args: &[String]) -> Result<(), String> {
    if args.first().is_none_or(|a| a.starts_with('-')) {
        return Err(tr!("Erstes Argument muss der git-Befehl sein, globale Optionen wie -C/-c sind nicht erlaubt", "The first argument must be the git command, global options like -C/-c are not allowed"));
    }
    // config/var listen die Env-Config samt Auth-Header; lokal geht beides über Bash.
    if ["config", "var"].contains(&args[0].as_str()) {
        return Err(tr!("git {} nur über Bash", "git {} only via Bash", args[0]));
    }
    match args.iter().find(|a| ["--upload-pack", "--receive-pack", "--exec"].iter().any(|o| a.starts_with(o))) {
        Some(a) => Err(tr!("Nicht erlaubt: {a}", "Not allowed: {a}")),
        None => Ok(()),
    }
}

async fn call<R: Runtime>(ctx: &Ctx<R>, name: &str, a: &Value) -> Result<Vec<Value>, String> {
    let query: Vec<(String, String)> = a["query"]
        .as_object()
        .map(|q| q.iter().map(|(k, v)| (k.clone(), v.as_str().map_or_else(|| v.to_string(), String::from))).collect())
        .unwrap_or_default();
    let path = a["path"].as_str().unwrap_or("");
    let out = match name {
        "git" => {
            let args: Vec<String> = a["args"].as_array().ok_or_else(|| tr!("args fehlt", "args missing"))?.iter().filter_map(|x| x.as_str().map(String::from)).collect();
            git_args_ok(&args)?;
            let repo = ctx.repo.clone();
            crate::git::blocking(move || {
                let o = crate::git::exec(crate::git::net(&repo).args(&args), None)?;
                let mut out = String::from_utf8_lossy(&o.stdout).into_owned();
                out.push_str(&String::from_utf8_lossy(&o.stderr));
                if o.status.success() { Ok(out) } else { Err(tr!("git beendet mit {}\n{out}", "git exited with {}\n{out}", o.status)) }
            })
            .await?
        }
        "forge_read" => crate::forge::mcp_call(&ctx.app, &ctx.repo, "GET", path, &query, None, a["accept"].as_str()).await?,
        "forge_write" => {
            let m = a["method"].as_str().unwrap_or("");
            if !["POST", "PATCH", "PUT", "DELETE"].contains(&m) {
                return Err(tr!("Methode nicht erlaubt: {m}", "Method not allowed: {m}"));
            }
            let body = a.get("body").filter(|b| !b.is_null());
            crate::forge::mcp_call(&ctx.app, &ctx.repo, m, path, &query, body, None).await?
        }
        "open_file" => {
            let ev = json!({ "repo": ctx.repo, "path": path, "line": a["line"].as_u64() });
            ctx.app.emit("ide-open", ev).map_err(|e| e.to_string())?;
            tr!("Geöffnet: {path}", "Opened: {path}")
        }
        "clean_images" => {
            let (days, here) = crate::images::parse(a["args"].as_str().unwrap_or(""))?;
            let sid = here.then(|| a["session"].as_str().unwrap_or("").to_string()).filter(|s| !s.is_empty());
            let r = crate::git::blocking(move || Ok(crate::images::clean(&crate::activity::config_dir(), days, sid.as_deref()))).await?;
            crate::images::summary(&r)
        }
        "lsp" | "debugger" | "run" => ask(ctx, name, a).await?,
        "editor_state" => editors().get(&ctx.repo).map_or_else(|| tr!("Editor für dieses Projekt nicht geöffnet.", "Editor not open for this project."), Value::to_string),
        "run_state" => runs().get(&ctx.repo).cloned().unwrap_or_else(|| tr!("Kein Run/Test für dieses Projekt.", "No run/test for this project.")),
        _ => return Err(tr!("Tool unbekannt: {name}", "Unknown tool: {name}")),
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
    tr!("{}\n… {} Zeichen gekürzt …\n{}", "{}\n… {} characters cut …\n{}", &s[..head], tail - head, &s[tail..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_args_nur_session_repo() {
        let v = |a: &[&str]| git_args_ok(&a.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert!(v(&["push", "-u", "origin", "x"]).is_ok() && v(&["status", "-sb"]).is_ok());
        for a in [&["-C", "/x", "push"][..], &["-c", "core.sshCommand=x", "push"], &["--git-dir=/x", "push"], &[], &["config", "-l"], &["fetch", "--upload-pack=sh", "/x"], &["push", "--receive-pack", "x"]] {
            assert!(v(a).is_err(), "{a:?}");
        }
    }

    #[test]
    fn notify_ohne_clients_ist_false() {
        let ides = Ides::<tauri::test::MockRuntime>::default();
        assert_eq!(ides.notify("/x", "at_mentioned", json!({})), Ok(false));
        assert!(ides.notify("/x", "boese", json!({})).is_err());
    }

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
            assert!(list.contains("\"editor_state\""), "{list}");
            let bearer = format!("Bearer {tok}");
            let es = || post(&http_port, &bearer, call(4, "editor_state", json!({})));
            assert!(es().await.contains("nicht geöffnet"));
            ide_editor_state("/anderes-repo".into(), json!({ "active": "fremd.rs" }));
            assert!(es().await.contains("nicht geöffnet"));
            let snap = json!({ "active": "a.rs", "files": [{ "path": "a.rs", "dirty": true, "conflict": null }], "selection": { "path": "a.rs", "startLine": 2, "endLine": 3, "text": "x" } });
            ide_editor_state(repo_s.clone(), snap);
            let r = es().await;
            assert!(r.contains(r#"\"dirty\":true"#) && r.contains("startLine") && !r.contains("fremd"), "{r}");
            ide_editor_state(repo_s.clone(), Value::Null);
            assert!(es().await.contains("nicht geöffnet"));
            assert!(list.contains("\"run_state\""), "{list}");
            let rs = || post(&http_port, &bearer, call(5, "run_state", json!({})));
            assert!(rs().await.contains("Kein Run/Test für dieses Projekt."));
            ide_run_state("/anderes-repo".into(), Some("fremd-log".into()));
            assert!(rs().await.contains("Kein Run/Test"));
            ide_run_state(repo_s.clone(), Some("$ npm test\nexit 1".into()));
            let r = rs().await;
            assert!(r.contains("npm test") && !r.contains("fremd"), "{r}");
            ide_run_state(repo_s.clone(), None);
            assert!(rs().await.contains("Kein Run/Test"));

            // Editor tools go to the frontend ("ide-ask") and come back via ide_answer, errors as isError.
            assert!(list.contains("\"lsp\"") && list.contains("\"debugger\"") && list.contains("\"run\""), "{list}");
            app.listen_any("ide-ask", |e| {
                let p: Value = serde_json::from_str(e.payload()).unwrap();
                ide_answer(p["id"].as_u64().unwrap(), p["tool"] == "run", format!("{}:{}", p["tool"].as_str().unwrap(), p["args"]["action"].as_str().unwrap_or("")));
            });
            let r = post(&http_port, &bearer, call(6, "run", json!({ "action": "list" }))).await;
            assert!(r.contains("run:list") && !r.contains("isError"), "{r}");
            let r = post(&http_port, &bearer, call(7, "debugger", json!({ "action": "state" }))).await;
            assert!(r.contains("debugger:state") && r.contains("\"isError\":true"), "{r}");
            assert!(asks().is_empty());

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

