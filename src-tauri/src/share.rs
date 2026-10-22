//! Sitzung teilen: der Host streamt das PTY einer Claude-Sitzung per iroh an Gaeste (QUIC, Ende-zu-Ende
//! verschluesselt, Hole-Punching, sonst ueber einen Relay von n0, der nur verschluesselte Pakete sieht).
//! claude laeuft nur beim Host. Gaeste sehen das Terminal, tippen nur mit Freigabe und lesen das
//! Aktivitaets-Panel ueber eine feste Liste von Aufrufen, die der Host mit eigenem cwd/id ausfuehrt.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use iroh::endpoint::{presets, Connection};
use iroh::{Endpoint, EndpointAddr};
use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot, OnceCell};

const ALPN: &[u8] = b"atelier/share/1";
const PREFIX: &str = "atelier1.";
// Grenze je Nachricht: Bilder und Panel-Antworten mit Vollbild als data-URL.
const MAX: usize = 64 << 20;

// Nachricht: 1 Byte Art, 4 Byte Laenge (big endian), Inhalt.
const HELLO: u8 = 0; // Gast: {key}; Host: {cwd, cols, rows, write}
const OUT: u8 = 1; // Host: PTY-Ausgabe roh
const SIZE: u8 = 2; // Host: {cols, rows}
const WRITE: u8 = 3; // Host: Gast darf tippen (true/false)
const INPUT: u8 = 4; // Gast: Tasten roh
const IMAGE: u8 = 5; // Gast: eingefuegtes Bild roh
const CALL: u8 = 6; // Gast: {n, cmd, args}
const REPLY: u8 = 7; // Host: {n, ok} oder {n, err}

type Frame = (u8, Vec<u8>);

async fn write_frame(w: &mut (impl AsyncWrite + Unpin), (kind, data): &Frame) -> std::io::Result<()> {
    w.write_u8(*kind).await?;
    w.write_u32(data.len() as u32).await?;
    w.write_all(data).await
}

async fn read_frame(r: &mut (impl AsyncRead + Unpin)) -> std::io::Result<Frame> {
    let kind = r.read_u8().await?;
    let len = r.read_u32().await? as usize;
    if len > MAX {
        return Err(std::io::Error::other("Nachricht zu groß"));
    }
    let mut data = vec![0; len];
    r.read_exact(&mut data).await?;
    Ok((kind, data))
}

/// Sendepuffer einer Verbindung, nach Bytes begrenzt: ein Schub (cat einer grossen Datei) passt durch,
/// ein haengendes Gegenueber fuellt nicht den Speicher.
#[derive(Clone)]
struct Queue {
    tx: mpsc::UnboundedSender<Frame>,
    queued: Arc<AtomicUsize>,
}

const QUEUE_MAX: usize = MAX + (32 << 20);

impl Queue {
    /// false = voll oder Verbindung weg.
    fn push(&self, f: Frame) -> bool {
        let n = f.1.len();
        if self.queued.fetch_add(n, Ordering::Relaxed) + n > QUEUE_MAX {
            self.queued.fetch_sub(n, Ordering::Relaxed);
            return false;
        }
        self.tx.send(f).is_ok()
    }
}

fn queue(mut w: impl AsyncWrite + Unpin + Send + 'static) -> Queue {
    let (tx, mut rx) = mpsc::unbounded_channel::<Frame>();
    let queued = Arc::new(AtomicUsize::new(0));
    let left = queued.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(f) = rx.recv().await {
            if write_frame(&mut w, &f).await.is_err() {
                break;
            }
            left.fetch_sub(f.1.len(), Ordering::Relaxed);
        }
    });
    Queue { tx, queued }
}

fn frame(kind: u8, v: Value) -> Frame {
    (kind, v.to_string().into_bytes())
}

fn random_hex(n: usize) -> Result<String, String> {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).map_err(|e| format!("Zufall nicht verfügbar: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// Je App ein Endpoint fuer Host und einer fuer Gast-Sitzungen (iroh verbindet nicht zu sich selbst, so kann
// eine App auch der eigenen Sitzung beitreten); die Schluessel wechseln mit jedem Start.
static ENDPOINT: OnceCell<Endpoint> = OnceCell::const_new();
static GUEST_ENDPOINT: OnceCell<Endpoint> = OnceCell::const_new();

fn builder() -> iroh::endpoint::Builder {
    // Firmen-Proxy wie bei reqwest (system-proxy)
    Endpoint::builder(presets::N0).proxy_from_env()
}

async fn guest_endpoint() -> Result<&'static Endpoint, String> {
    GUEST_ENDPOINT
        .get_or_try_init(|| async { builder().bind().await.map_err(|e| format!("Netzwerk für Teilen nicht verfügbar: {e}")) })
        .await
}

// Generisch ueber Runtime fuer den Test mit mock_app.
async fn endpoint<R: Runtime>(app: &AppHandle<R>) -> Result<&'static Endpoint, String> {
    ENDPOINT
        .get_or_try_init(|| async {
            let ep = builder()
                .alpns(vec![ALPN.to_vec()])
                .bind()
                .await
                .map_err(|e| format!("Netzwerk für Teilen nicht verfügbar: {e}"))?;
            let (app, acc) = (app.clone(), ep.clone());
            tauri::async_runtime::spawn(async move {
                while let Some(inc) = acc.accept().await {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Ok(conn) = inc.await {
                            host_conn(app, conn).await;
                        }
                    });
                }
            });
            Ok(ep)
        })
        .await
}

fn ticket(addr: &EndpointAddr, key: &str) -> String {
    format!("{PREFIX}{}", B64.encode(json!({ "addr": addr, "key": key }).to_string()))
}

fn parse_ticket(t: &str) -> Result<(EndpointAddr, String), String> {
    let bad = || "Einladung beschädigt".to_string();
    let raw = t.trim().strip_prefix(PREFIX).ok_or("Keine Atelier-Einladung")?;
    let v: Value = serde_json::from_slice(&B64.decode(raw).map_err(|_| bad())?).map_err(|_| bad())?;
    let addr = serde_json::from_value(v["addr"].clone()).map_err(|_| bad())?;
    let key = v["key"].as_str().filter(|k| !k.is_empty()).ok_or_else(bad)?;
    Ok((addr, key.into()))
}

// ---- Host ----

struct Guest {
    gid: u64,
    tx: Queue,
    conn: Connection,
}

// Wer aus der Liste faellt (Teilen beendet, kommt nicht hinterher), verliert auch die Verbindung.
impl Drop for Guest {
    fn drop(&mut self) {
        self.conn.close(0u32.into(), b"bye");
    }
}

struct Share {
    key: String,
    ticket: String,
    cwd: String,
    size: (u16, u16),
    write: bool,
    // Session-id aus dem letzten claude_activity; Bilder und Agent-Logs nur aus dieser.
    sid: Option<String>,
    guests: Vec<Guest>,
}

impl Share {
    fn send(&mut self, f: &Frame) {
        // Voller Puffer = Gast haengt; rauswerfen statt den Speicher des Hosts zu fuellen.
        self.guests.retain(|g| g.tx.push(f.clone()));
    }
}

static HOSTS: LazyLock<Mutex<HashMap<String, Share>>> = LazyLock::new(Default::default);
static NEXT: AtomicU64 = AtomicU64::new(0);

fn hosts() -> MutexGuard<'static, HashMap<String, Share>> {
    lock(&HOSTS)
}

fn guests_changed<R: Runtime>(app: &AppHandle<R>, id: &str, joined: bool) {
    let n = hosts().get(id).map_or(0, |s| s.guests.len());
    let _ = app.emit(&format!("share:{id}"), json!({ "guests": n, "joined": joined }));
}

/// Aus dem Lese-Thread des PTY (pty.rs): Ausgabe an alle Gaeste der Sitzung.
pub fn output(id: &str, chunk: &[u8]) {
    if let Some(s) = hosts().get_mut(id) {
        s.send(&(OUT, chunk.to_vec()));
    }
}

/// Aus pty_resize: Gaeste zeichnen in derselben Groesse wie der Host.
pub fn resized(id: &str, cols: u16, rows: u16) {
    if let Some(s) = hosts().get_mut(id) {
        s.size = (cols, rows);
        s.send(&frame(SIZE, json!({ "cols": cols, "rows": rows })));
    }
}

/// Teilen der Sitzung beenden bzw. als Gast trennen (pty_close).
pub fn stop(id: &str) {
    let share = hosts().remove(id);
    drop(share);
    let guest = lock(&REMOTES).remove(id);
    if let Some(r) = guest {
        r.conn.close(0u32.into(), b"bye");
    }
}

#[tauri::command]
pub async fn share_start(app: AppHandle, ptys: State<'_, crate::pty::Ptys>, id: String, cwd: String) -> Result<String, String> {
    if let Some(s) = hosts().get(&id) {
        return Ok(s.ticket.clone());
    }
    let size = crate::pty::size(&ptys, &id).ok_or("Sitzung läuft nicht")?;
    let ep = endpoint(&app).await?;
    // Ohne Relay-Adresse in der Einladung finden Gaeste hinter NAT den Host nur ueber die DNS-Suche.
    let _ = tokio::time::timeout(Duration::from_secs(10), ep.online()).await;
    let key = random_hex(16)?;
    let ticket = ticket(&ep.addr(), &key);
    let s = Share { key, ticket: ticket.clone(), cwd, size, write: false, sid: None, guests: vec![] };
    Ok(hosts().entry(id).or_insert(s).ticket.clone())
}

#[tauri::command]
pub fn share_stop(id: String) {
    let share = hosts().remove(&id);
    drop(share);
}

#[tauri::command]
pub fn share_write(id: String, on: bool) {
    if let Some(s) = hosts().get_mut(&id) {
        s.write = on;
        s.send(&frame(WRITE, json!(on)));
    }
}

/// Bildschirm des Hosts (xterm serialisiert) fuer neu beigetretene Gaeste; vorn ein Reset, damit es auch
/// bei den schon verbundenen sauber neu zeichnet.
#[tauri::command]
pub fn share_snapshot(id: String, data: String) {
    if let Some(s) = hosts().get_mut(&id) {
        s.send(&(OUT, data.into_bytes()));
    }
}

async fn host_conn<R: Runtime>(app: AppHandle<R>, conn: Connection) {
    let Ok((send, mut recv)) = conn.accept_bi().await else { return };
    let Ok(Ok((HELLO, data))) = tokio::time::timeout(Duration::from_secs(10), read_frame(&mut recv)).await else { return };
    let key = serde_json::from_slice::<Value>(&data).ok().and_then(|v| v["key"].as_str().map(String::from));
    let tx = queue(send);
    let gid = NEXT.fetch_add(1, Ordering::Relaxed);
    let id = {
        let mut h = hosts();
        let Some((id, s)) = h.iter_mut().find(|(_, s)| Some(&s.key) == key.as_ref()) else {
            conn.close(1u32.into(), b"invalid");
            return;
        };
        let hello = json!({ "cwd": s.cwd, "cols": s.size.0, "rows": s.size.1, "write": s.write });
        tx.push(frame(HELLO, hello));
        s.guests.push(Guest { gid, tx: tx.clone(), conn: conn.clone() });
        id.clone()
    };
    guests_changed(&app, &id, true);
    while let Ok((kind, data)) = read_frame(&mut recv).await {
        match kind {
            INPUT if allowed(&id) => {
                let text = guest_keys(&String::from_utf8_lossy(&data));
                let _ = crate::pty::write(&app.state::<crate::pty::Ptys>(), &id, text);
            }
            IMAGE if allowed(&id) => {
                if let Ok(p) = save_image(&data) {
                    let _ = crate::pty::write(&app.state::<crate::pty::Ptys>(), &id, paste_path(&p, cfg!(windows)));
                }
            }
            CALL => {
                let (id, tx) = (id.clone(), tx.clone());
                tauri::async_runtime::spawn(async move {
                    let req: Value = serde_json::from_slice(&data).unwrap_or_default();
                    let n = req["n"].clone();
                    let res = call(&id, req["cmd"].as_str().unwrap_or_default(), &req["args"]).await;
                    let v = match res {
                        Ok(ok) => json!({ "n": n, "ok": ok }),
                        Err(err) => json!({ "n": n, "err": err }),
                    };
                    tx.push(frame(REPLY, v));
                });
            }
            _ => {}
        }
    }
    if let Some(s) = hosts().get_mut(&id) {
        s.guests.retain(|g| g.gid != gid);
    }
    guests_changed(&app, &id, false);
}

fn allowed(id: &str) -> bool {
    hosts().get(id).is_some_and(|s| s.write)
}

/// claude holt sich bei Strg+V (\x16) und leerem Einfuegen ein Bild aus der Zwischenablage, und zwar der des
/// Hosts. Gaeste schicken Bilder als IMAGE, darum beides aus ihren Tasten streichen.
fn guest_keys(s: &str) -> String {
    s.replace("\x1b[200~\x1b[201~", "").replace('\x16', "")
}

/// Bild eines Gastes als Datei beim Host; claude erkennt den eingefuegten Pfad als Bild.
// shortcut: Dateien bleiben im Temp-Ordner liegen, bis das System ihn aufraeumt.
fn save_image(bytes: &[u8]) -> Result<PathBuf, String> {
    use image::ImageFormat::*;
    let ext = match image::guess_format(bytes).map_err(|_| "Kein Bild")? {
        Png => "png",
        Jpeg => "jpg",
        Gif => "gif",
        WebP => "webp",
        f => return Err(format!("Bildformat nicht unterstützt: {f:?}")),
    };
    let dir = std::env::temp_dir().join("atelier-share");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(format!("{}.{ext}", random_hex(8)?));
    std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok(p)
}

/// Pfad gequotet wie beim Datei-Drop im Terminal, als Bracketed Paste.
fn paste_path(p: &std::path::Path, windows: bool) -> String {
    let p = p.to_string_lossy();
    let q = if windows { format!("\"{p}\"") } else { format!("'{}'", p.replace('\'', "'\\''")) };
    format!("\x1b[200~{q} \x1b[201~")
}

fn json(v: Result<impl serde::Serialize, String>) -> Result<Value, String> {
    v.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

/// Panel-Aufrufe der Gaeste: nur lesende, cwd und id immer die der geteilten Sitzung.
async fn call(id: &str, cmd: &str, args: &Value) -> Result<Value, String> {
    let (cwd, sid) = hosts().get(id).map(|s| (s.cwd.clone(), s.sid.clone())).ok_or("Teilen beendet")?;
    let arg = |k: &str| args[k].as_str().unwrap_or_default().to_string();
    let own = || match &sid {
        Some(s) if *s == arg("sid") => Ok(s.clone()),
        _ => Err("Fremde Sitzung".to_string()),
    };
    let nth = || args["id"].as_u64().map(|n| n as usize).ok_or("Ungültiges Bild".to_string());
    match cmd {
        "claude_activity" => {
            let a = crate::activity::claude_activity(cwd, id.into()).await?;
            if let Some(s) = hosts().get_mut(id) {
                s.sid = a.session.clone();
            }
            json(Ok(a))
        }
        "claude_image" => crate::activity::claude_image(own()?, nth()?).await.map(Value::from),
        "claude_thumb" => crate::activity::claude_thumb(own()?, nth()?).await.map(Value::from),
        "claude_agent_log" => json(crate::activity::claude_agent_log(cwd, own()?, arg("run"), arg("agent")).await),
        "workflows_list" => json(crate::workflows::workflows_list(cwd).await),
        _ => Err(format!("Für Gäste nicht erlaubt: {cmd}")),
    }
}

// ---- Gast ----

struct Remote {
    tx: Queue,
    calls: HashMap<u64, oneshot::Sender<Result<Value, String>>>,
    conn: Connection,
}

static REMOTES: LazyLock<Mutex<HashMap<String, Remote>>> = LazyLock::new(Default::default);

/// Aus pty_write: Tasten einer Gast-Sitzung gehen an den Host. None = keine Gast-Sitzung.
pub fn input(id: &str, data: String) -> Option<Result<(), String>> {
    let r = lock(&REMOTES);
    let ok = r.get(id)?.tx.push((INPUT, data.into_bytes()));
    Some(if ok { Ok(()) } else { Err("Verbindung zum Host unterbrochen".into()) })
}

/// Einladung annehmen: verbindet, liefert {cwd, cols, rows, write} des Hosts, Ausgabe danach ueber `out`.
#[tauri::command]
pub async fn share_join(app: AppHandle, id: String, ticket: String, out: Channel<InvokeResponseBody>) -> Result<Value, String> {
    if !crate::pty::valid_id(&id) {
        return Err(format!("Ungueltige Terminal-id: {id}"));
    }
    let (addr, key) = parse_ticket(&ticket)?;
    let ep = guest_endpoint().await?;
    join(app, ep, id, addr, key, out).await
}

async fn join<R: Runtime>(app: AppHandle<R>, ep: &Endpoint, id: String, addr: EndpointAddr, key: String, out: Channel<InvokeResponseBody>) -> Result<Value, String> {
    let conn = tokio::time::timeout(Duration::from_secs(30), ep.connect(addr, ALPN))
        .await
        .map_err(|_| "Host nicht erreichbar (Zeitüberschreitung)".to_string())?
        .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))?;
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))?;
    write_frame(&mut send, &frame(HELLO, json!({ "key": key }))).await.map_err(|e| e.to_string())?;
    let ended = || "Einladung ungültig oder Teilen beendet".to_string();
    let hello = match tokio::time::timeout(Duration::from_secs(15), read_frame(&mut recv)).await {
        Ok(Ok((HELLO, data))) => serde_json::from_slice::<Value>(&data).map_err(|_| ended())?,
        _ => return Err(ended()),
    };
    lock(&REMOTES).insert(id.clone(), Remote { tx: queue(send), calls: HashMap::new(), conn: conn.clone() });
    tauri::async_runtime::spawn(async move {
        while let Ok((kind, data)) = read_frame(&mut recv).await {
            match kind {
                OUT => {
                    let _ = out.send(InvokeResponseBody::Raw(data));
                }
                SIZE => {
                    let _ = app.emit(&format!("share-size:{id}"), serde_json::from_slice::<Value>(&data).unwrap_or_default());
                }
                WRITE => {
                    let _ = app.emit(&format!("share-write:{id}"), data == b"true");
                }
                REPLY => {
                    let v: Value = serde_json::from_slice(&data).unwrap_or_default();
                    let waiter = v["n"].as_u64().and_then(|n| lock(&REMOTES).get_mut(&id)?.calls.remove(&n));
                    if let Some(w) = waiter {
                        let res = match v["err"].as_str() {
                            Some(e) => Err(e.to_string()),
                            None => Ok(v["ok"].clone()),
                        };
                        let _ = w.send(res);
                    }
                }
                _ => {}
            }
        }
        // Selbst getrennt (pty_close) ist der Eintrag schon weg; sonst hat der Host beendet.
        let gone = lock(&REMOTES).remove(&id);
        if let Some(r) = gone {
            r.conn.close(0u32.into(), b"bye");
            let _ = app.emit(&format!("pty-exit:{id}"), Value::Null);
        }
    });
    Ok(hello)
}

/// Panel-Aufruf einer Gast-Sitzung, ausgefuehrt beim Host (siehe `call`).
#[tauri::command]
pub async fn share_call(id: String, cmd: String, args: Value) -> Result<Value, String> {
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let (wait_tx, wait) = oneshot::channel();
    let tx = {
        let mut r = lock(&REMOTES);
        let remote = r.get_mut(&id).ok_or("Keine Verbindung zum Host")?;
        remote.calls.insert(n, wait_tx);
        remote.tx.clone()
    };
    if !tx.push(frame(CALL, json!({ "n": n, "cmd": cmd, "args": args }))) {
        return Err("Keine Verbindung zum Host".into());
    }
    let res = tokio::time::timeout(Duration::from_secs(30), wait).await;
    if let Some(r) = lock(&REMOTES).get_mut(&id) {
        r.calls.remove(&n);
    }
    match res {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => Err("Keine Verbindung zum Host".into()),
        Err(_) => Err("Host antwortet nicht".into()),
    }
}

/// Eingefuegtes Bild eines Gastes, roh als Body; Header `id` = Terminal.
#[tauri::command]
pub async fn share_image(request: Request<'_>) -> Result<(), String> {
    let id = request.headers().get("id").and_then(|v| v.to_str().ok()).ok_or("id fehlt")?;
    let InvokeBody::Raw(data) = request.body() else { return Err("Bild fehlt".into()) };
    if data.len() > MAX {
        return Err("Bild zu groß".into());
    }
    let tx = lock(&REMOTES).get(id).map(|r| r.tx.clone()).ok_or("Keine Verbindung zum Host")?;
    if !tx.push((IMAGE, data.clone())) {
        return Err("Keine Verbindung zum Host".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frames_roundtrip_und_grenze() {
        let (mut a, mut b) = tokio::io::duplex(1 << 16);
        write_frame(&mut a, &(OUT, b"hallo".to_vec())).await.unwrap();
        write_frame(&mut a, &(INPUT, vec![])).await.unwrap();
        assert_eq!(read_frame(&mut b).await.unwrap(), (OUT, b"hallo".to_vec()));
        assert_eq!(read_frame(&mut b).await.unwrap(), (INPUT, vec![]));
        // Zu grosse Laenge wird abgelehnt, ohne Speicher zu reservieren.
        a.write_all(&[IMAGE, 0xff, 0xff, 0xff, 0xff]).await.unwrap();
        assert!(read_frame(&mut b).await.is_err());
    }

    /// Host und Gast ueber echte iroh-Verbindungen (lokal, direkte Adressen): Ausgabe in Reihenfolge auch bei
    /// viel Text, Panel-Aufrufe nur aus der Liste, falscher Schluessel abgewiesen, Beenden trennt den Gast.
    #[test]
    fn ende_zu_ende_lokal() {
        let app = tauri::test::mock_app();
        app.manage(crate::pty::Ptys::default());
        let app = app.handle().clone();
        tauri::async_runtime::block_on(async move {
            let host = endpoint(&app).await.unwrap();
            let cwd = std::env::temp_dir().to_string_lossy().into_owned();
            let addr = host.addr();
            let share = Share { key: "k1".into(), ticket: ticket(&addr, "k1"), cwd: cwd.clone(), size: (80, 24), write: false, sid: None, guests: vec![] };
            hosts().insert("h1".into(), share);
            let guest_ep = Endpoint::bind(presets::Minimal).await.unwrap();

            let got = Arc::new(Mutex::new(Vec::<u8>::new()));
            let sink = got.clone();
            let out = Channel::new(move |b| {
                if let InvokeResponseBody::Raw(d) = b {
                    lock(&sink).extend_from_slice(&d);
                }
                Ok(())
            });
            let wrong = join(app.clone(), &guest_ep, "g0".into(), addr.clone(), "falsch".into(), Channel::new(|_| Ok(()))).await;
            assert!(wrong.is_err());
            let hello = join(app.clone(), &guest_ep, "g1".into(), addr, "k1".into(), out).await.unwrap();
            assert_eq!((hello["cwd"].as_str(), hello["cols"].as_u64(), hello["write"].as_bool()), (Some(cwd.as_str()), Some(80), Some(false)));
            assert_eq!(hosts()["h1"].guests.len(), 1);

            // ~8 MB als Schub ohne Pause: alles kommt an, in Reihenfolge, der Gast fliegt nicht raus.
            let mut want = Vec::new();
            for i in 0..2000 {
                let chunk = format!("{i:05} {}\r\n", "x".repeat(4000));
                want.extend_from_slice(chunk.as_bytes());
                output("h1", chunk.as_bytes());
            }
            let t0 = std::time::Instant::now();
            while lock(&got).len() < want.len() && t0.elapsed() < Duration::from_secs(20) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert!(*lock(&got) == want, "Ausgabe unvollstaendig: {} von {} Bytes", lock(&got).len(), want.len());

            let a = share_call("g1".into(), "claude_activity".into(), json!({ "cwd": "/etc", "id": "fremd" })).await.unwrap();
            assert!(a.get("images").is_some());
            let err = share_call("g1".into(), "workflows_delete".into(), json!({})).await.unwrap_err();
            assert!(err.contains("nicht erlaubt"), "{err}");
            let err = share_call("g1".into(), "claude_image".into(), json!({ "sid": "andere", "id": 0 })).await.unwrap_err();
            assert_eq!(err, "Fremde Sitzung");

            share_stop("h1".into());
            let t0 = std::time::Instant::now();
            while lock(&REMOTES).contains_key("g1") && t0.elapsed() < Duration::from_secs(5) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert!(!lock(&REMOTES).contains_key("g1"), "Gast nach Beenden noch verbunden");
        });
    }

    /// Wie hinter NAT: Gast kennt nur id und Relay des Hosts, Verbindung ueber die n0-Server. Braucht Netz:
    /// cargo test --lib share::tests::ueber_relay -- --ignored
    #[test]
    #[ignore]
    fn ueber_relay() {
        let app = tauri::test::mock_app();
        let app = app.handle().clone();
        tauri::async_runtime::block_on(async move {
            let host = endpoint(&app).await.unwrap();
            tokio::time::timeout(Duration::from_secs(15), host.online()).await.expect("Host nicht online");
            let full = host.addr();
            let relay = full.relay_urls().next().expect("keine Relay-Adresse").clone();
            let addr = EndpointAddr::new(full.id).with_relay_url(relay);
            let share = Share { key: "k2".into(), ticket: String::new(), cwd: "/".into(), size: (80, 24), write: false, sid: None, guests: vec![] };
            hosts().insert("h2".into(), share);
            let got = Arc::new(Mutex::new(Vec::<u8>::new()));
            let sink = got.clone();
            let out = Channel::new(move |b| {
                if let InvokeResponseBody::Raw(d) = b {
                    lock(&sink).extend_from_slice(&d);
                }
                Ok(())
            });
            let t0 = std::time::Instant::now();
            join(app.clone(), guest_endpoint().await.unwrap(), "g2".into(), addr, "k2".into(), out).await.unwrap();
            println!("verbunden nach {:?}", t0.elapsed());
            let want = "x".repeat(1 << 20);
            output("h2", want.as_bytes());
            while lock(&got).len() < want.len() && t0.elapsed() < Duration::from_secs(30) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            println!("1 MB nach {:?}", t0.elapsed());
            assert_eq!(lock(&got).len(), want.len());
            share_stop("h2".into());
        });
    }

    #[test]
    fn queue_voll_nach_bytes() {
        tauri::async_runtime::block_on(async {
            // Gegenueber liest nie: der Schreiber haengt, der Puffer laeuft voll.
            let (w, _r) = tokio::io::duplex(1024);
            let q = queue(w);
            let mb = || (OUT, vec![0u8; 1 << 20]);
            let n = (0..200).take_while(|_| q.push(mb())).count();
            assert_eq!(n, QUEUE_MAX >> 20);
        });
    }

    #[test]
    fn ticket_roundtrip() {
        let id = iroh::SecretKey::from_bytes(&[7; 32]).public();
        let t = ticket(&EndpointAddr::new(id), "abc");
        let (addr, key) = parse_ticket(&format!("  {t}\n")).unwrap();
        assert_eq!((addr.id, key.as_str()), (id, "abc"));
        assert!(parse_ticket("atelier1.kaputt").is_err());
        assert!(parse_ticket("irgendwas").is_err());
    }

    #[test]
    fn gast_kann_keine_zwischenablage_des_hosts_holen() {
        assert_eq!(guest_keys("a\x16b\x1b[200~\x1b[201~c"), "abc");
        // Echtes Einfuegen bleibt.
        assert_eq!(guest_keys("\x1b[200~text\x1b[201~"), "\x1b[200~text\x1b[201~");
    }

    #[test]
    fn bild_nur_mit_bekanntem_format() {
        assert!(save_image(b"kein bild").is_err());
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
        let p = save_image(&png).unwrap();
        assert_eq!(p.extension().unwrap(), "png");
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn pfad_gequotet_als_paste() {
        let p = std::path::Path::new("/tmp/a'b.png");
        assert_eq!(paste_path(p, false), "\x1b[200~'/tmp/a'\\''b.png' \x1b[201~");
        assert_eq!(paste_path(std::path::Path::new("C:\\T e\\x.png"), true), "\x1b[200~\"C:\\T e\\x.png\" \x1b[201~");
    }
}
