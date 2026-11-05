//! Debug builds only: drive the UI from a test script without mouse, keyboard or window focus (scripts/ui.mjs).
//! HTTP on 127.0.0.1 with a random port and token, both in <temp>/ocui-dev-bridge.json (0600).
//! POST /eval: the body is the body of an async JS function, run in the main webview; its return value comes back as JSON.
//! POST /size?w=&h=: logical window size.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, LogicalSize, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

type Reply = oneshot::Sender<(bool, Value)>;
static WAIT: Mutex<Vec<(u64, Reply)>> = Mutex::new(Vec::new());
static NEXT: AtomicU64 = AtomicU64::new(1);

fn wait() -> std::sync::MutexGuard<'static, Vec<(u64, Reply)>> {
    WAIT.lock().unwrap_or_else(|e| e.into_inner())
}

/// Result of an /eval snippet, from the snippet's wrapper in the webview.
#[tauri::command]
pub fn dev_bridge_reply(id: u64, ok: bool, value: Value) {
    let mut w = wait();
    if let Some(i) = w.iter().position(|(k, _)| *k == id) {
        let _ = w.remove(i).1.send((ok, value));
    }
}

pub fn file() -> std::path::PathBuf {
    std::env::temp_dir().join("ocui-dev-bridge.json")
}

pub fn start(app: &AppHandle) {
    // Started in the background (scripts/dev-bg.mjs): keep rendering while covered by other windows, so screenshots
    // stay current. Private WebKit switch, also what Electron uses for backgroundThrottling: false. Off the active
    // Space (e.g. another app in full screen) WebKit still pauses rendering; scripts/ui.mjs copes with that.
    #[cfg(target_os = "macos")]
    if let (Some(_), Some(w)) = (std::env::var_os("OCUI_BACKGROUND"), app.get_webview_window("main")) {
        let _ = w.with_webview(|wv| unsafe {
            use objc2::runtime::{AnyObject, Bool};
            use objc2::{msg_send, sel};
            let v = &*(wv.inner() as *const AnyObject);
            let sel = sel!(_setWindowOcclusionDetectionEnabled:);
            let ok: Bool = msg_send![v, respondsToSelector: sel];
            if ok.as_bool() {
                let _: () = msg_send![v, _setWindowOcclusionDetectionEnabled: Bool::NO];
            }
        });
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut b = [0u8; 16];
        if getrandom::fill(&mut b).is_err() {
            return;
        }
        let token: String = b.iter().map(|x| format!("{x:02x}")).collect();
        let Ok(l) = TcpListener::bind("127.0.0.1:0").await else { return };
        let Ok(port) = l.local_addr().map(|a| a.port()) else { return };
        if write_private(&file(), &json!({ "port": port, "token": token, "pid": std::process::id() }).to_string()).is_err() {
            return;
        }
        while let Ok((s, _)) = l.accept().await {
            let (app, token) = (app.clone(), token.clone());
            tauri::async_runtime::spawn(async move {
                let _ = conn(s, &app, &token).await;
            });
        }
    });
}

fn write_private(p: &std::path::Path, text: &str) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let _ = std::fs::remove_file(p);
        std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(p)?.write_all(text.as_bytes())
    }
    #[cfg(not(unix))]
    std::fs::write(p, text)
}

async fn conn(mut s: TcpStream, app: &AppHandle, token: &str) -> std::io::Result<()> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 65536];
    // Head, then exactly Content-Length bytes of body.
    let (head, body_at) = loop {
        let n = s.read(&mut chunk).await?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break (String::from_utf8_lossy(&buf[..i]).into_owned(), i + 4);
        }
        if buf.len() > 1 << 16 {
            return Ok(());
        }
    };
    let header = |name: &str| {
        head.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_string()))
    };
    let want = format!("Bearer {token}");
    let got = header("authorization").unwrap_or_default();
    // Constant time: no timing hint about how much of the token matched.
    let auth = got.len() == want.len() && got.bytes().zip(want.bytes()).fold(0, |a, (x, y)| a | (x ^ y)) == 0;
    // Without the token no body is read, so unauthenticated clients cannot make it buffer.
    let len: usize = if auth { header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0).min(8 << 20) } else { 0 };
    while buf.len() < body_at + len {
        let n = s.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let body = String::from_utf8_lossy(&buf[body_at..(body_at + len).min(buf.len())]).into_owned();
    let target = head.split_whitespace().nth(1).unwrap_or("").to_string();
    let (status, out) = if !auth {
        ("401 Unauthorized", json!({ "ok": false, "value": "token" }))
    } else if let Some(q) = target.strip_prefix("/size?") {
        let num = |k: &str| q.split('&').find_map(|p| p.strip_prefix(&format!("{k}="))).and_then(|v| v.parse::<f64>().ok());
        let r = match (app.get_webview_window("main"), num("w"), num("h")) {
            (Some(w), Some(x), Some(y)) => w.set_size(LogicalSize::new(x, y)).map_err(|e| e.to_string()),
            _ => Err("main window or w/h missing".into()),
        };
        ("200 OK", json!({ "ok": r.is_ok(), "value": r.err() }))
    } else if target == "/eval" {
        ("200 OK", eval(app, &body).await)
    } else {
        ("404 Not Found", json!({ "ok": false, "value": "POST /eval or /size" }))
    };
    let text = out.to_string();
    let res = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len());
    s.write_all(res.as_bytes()).await
}

async fn eval(app: &AppHandle, body: &str) -> Value {
    let Some(w) = app.get_webview_window("main") else { return json!({ "ok": false, "value": "no main window" }) };
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    wait().push((id, tx));
    // WebKit stacks lack the message, so String(e); undefined becomes null so the reply always serializes.
    let js = format!(
        "(async () => {{\n{body}\n}})().then(v => [true, v === undefined ? null : v], e => [false, String(e)])\
         .then(([ok, value]) => window.__TAURI_INTERNALS__.invoke('dev_bridge_reply', {{ id: {id}, ok, value }})\
         .catch(err => window.__TAURI_INTERNALS__.invoke('dev_bridge_reply', {{ id: {id}, ok: false, value: 'result not serializable: ' + err }})));"
    );
    let r = match w.eval(&js) {
        Ok(()) => tokio::time::timeout(Duration::from_secs(120), rx).await.ok().and_then(Result::ok),
        Err(e) => Some((false, Value::String(e.to_string()))),
    };
    wait().retain(|(k, _)| *k != id);
    let (ok, value) = r.unwrap_or((false, Value::String("timeout (120 s) or reload".into())));
    json!({ "ok": ok, "value": value })
}
