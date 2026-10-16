//! Wach-Halt bei zugeklapptem Laptop, nur solange Claude arbeitet (Einstellung "lidAwake", Standard aus).
//! Sonst schlaeft der Rechner wie gewohnt; wird Claude fertig, waehrend der Deckel zu ist, schlaeft er ein.
//! - Arbeitet: Mod-Flag "busy" in der Panel-Datei einer Session (mit Heartbeat, frisch < 90 s), Transkripte von
//!   Subagents/Workflows wurden in den letzten 90 s geschrieben, oder die TUI einer Session zeichnet laufend
//!   (Spinner, auch waehrend ein genehmigtes Tool laeuft; wartend steht sie still). Unter 20 % Akku: nie.
//! - Linux: logind-Inhibitor (systemd-inhibit) als Kindprozess; endet mit uns, auch beim Absturz.
//! - macOS: Deckel-Schlaf ignoriert normale Assertions; stattdessen der Clamshell-Schalter von IOPMrootDomain (ohne
//!   Root, ohne `pmset disablesleep`), gehalten von einem Waechter-Prozess, der ihn beim Ende der App zuruecksetzt.
//! - Windows: Deckel-Aktion des Energieplans voruebergehend "Nichts unternehmen"; alter Wert in einer Markerdatei,
//!   nach Absturz beim naechsten Start zurueckgeschrieben.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use tauri::{AppHandle, Emitter, Manager};

static ON: AtomicBool = AtomicBool::new(false);
/// Halt aktiv (Kindprozess bzw. Marker gesetzt).
static HELD: Mutex<Option<Hold>> = Mutex::new(None);
/// Wie frisch Panel-Datei bzw. Agent-Transkript sein muessen, um als "arbeitet" zu gelten.
const FRESH: Duration = Duration::from_secs(90);

#[cfg_attr(windows, allow(dead_code))]
struct Hold(Option<std::process::Child>);

/// Meldung aus recover() beim Start: das Frontend lauscht da noch nicht, es holt sie mit set_awake ab.
static PENDING_ERR: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
pub fn set_awake(on: bool) -> Option<String> {
    ON.store(on, Ordering::Relaxed);
    PENDING_ERR.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Ausgabe-Zeitpunkte je Claude-Terminal (pty.rs), nur die letzten Sekunden.
static OUTPUT: Mutex<Option<HashMap<String, VecDeque<Instant>>>> = Mutex::new(None);
const DRAW_WINDOW: Duration = Duration::from_secs(10);
/// Spinner zeichnet mehrmals pro Sekunde; ein einzelnes Neuzeichnen (Uhr, Statuszeile) bleibt darunter.
const DRAWS: usize = 20;

pub fn output(id: &str) {
    let now = Instant::now();
    let mut m = OUTPUT.lock().unwrap_or_else(|e| e.into_inner());
    let q = m.get_or_insert_with(HashMap::new).entry(id.to_string()).or_default();
    q.push_back(now);
    while q.len() > 64 || q.front().is_some_and(|t| now.duration_since(*t) > DRAW_WINDOW) {
        q.pop_front();
    }
}

pub fn forget(id: &str) {
    if let Some(m) = OUTPUT.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        m.remove(id);
    }
}

fn drawing(q: &VecDeque<Instant>, now: Instant) -> bool {
    q.iter().filter(|t| now.duration_since(**t) < DRAW_WINDOW).count() >= DRAWS
}

fn animating(now: Instant) -> bool {
    OUTPUT.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|m| m.values().any(|q| drawing(q, now)))
}

fn marker(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("awake.marker"))
}

/// Beim Start (im eigenen Thread: recover kann auf macOS nach dem Passwort fragen): Reste eines Absturzes
/// zuruecksetzen, dann alle 3 s pruefen.
pub fn start(app: &AppHandle) {
    let Some(m) = marker(app) else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = recover(&m) {
            *PENDING_ERR.lock().unwrap_or_else(|e| e.into_inner()) = Some(e.clone());
            let _ = app.emit("awake-error", e);
        }
        loop {
            let want = ON.load(Ordering::Relaxed) && working(&app, SystemTime::now()) && !low_battery();
            let held = guard().is_some();
            if want && !held {
                match hold(&m) {
                    Ok(h) => {
                        *guard() = Some(h);
                        // Waehrend hold() (Passwortdialog) beendet oder ausgeschaltet: gleich wieder freigeben.
                        if !ON.load(Ordering::Relaxed) {
                            free(&m);
                        }
                    }
                    Err(e) => {
                        // Nicht alle 3 s erneut versuchen und melden.
                        ON.store(false, Ordering::Relaxed);
                        let _ = app.emit("awake-error", e);
                    }
                }
            } else if !want && held {
                free(&m);
            }
            keep_idle_awake(want);
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

fn free(m: &Path) {
    if let Some(h) = guard().take() {
        release(h, m);
    }
}

fn guard() -> std::sync::MutexGuard<'static, Option<Hold>> {
    HELD.lock().unwrap_or_else(|e| e.into_inner())
}

/// App-Ende: Halt sofort freigeben (der Mac-Waechter merkt das Ende auch selbst).
pub fn stop(app: &AppHandle) {
    // Zuerst: ein gerade laufendes hold() im Thread gibt danach selbst wieder frei.
    ON.store(false, Ordering::Relaxed);
    if let Some(m) = marker(app) {
        free(&m);
    }
}

fn working(app: &AppHandle, now: SystemTime) -> bool {
    let panels = crate::activity::panel_dir();
    busy_panel(&panels, now) || animating(Instant::now()) || app.state::<crate::ide::Ides>().repos().iter().any(|r| agents_recent(r, now))
}

fn fresh(p: &Path, now: SystemTime) -> bool {
    std::fs::metadata(p).and_then(|m| m.modified()).is_ok_and(|t| now.duration_since(t).unwrap_or_default() < FRESH)
}

/// Eine Session meldet busy und hat in den letzten 90 s geschrieben (Heartbeat; abgestuerztes claude zaehlt nicht).
fn busy_panel(dir: &Path, now: SystemTime) -> bool {
    std::fs::read_dir(dir).into_iter().flatten().flatten().any(|e| {
        let p = e.path();
        p.extension().is_some_and(|x| x == "json")
            && fresh(&p, now)
            && std::fs::read_to_string(&p)
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .is_some_and(|v| v["busy"] == true)
    })
}

/// Subagents/Workflows einer Claude-Session im Projekt haben gerade geschrieben (laufen noch, wenn der Haupt-Turn schon
/// fertig ist). Liegen unter ~/.claude/projects/<slug>/<session>/subagents/.
fn agents_recent(repo: &str, now: SystemTime) -> bool {
    agents_recent_in(&crate::activity::config_dir().join("projects").join(crate::activity::slug(&crate::activity::real(repo))), now)
}

fn agents_recent_in(project: &Path, now: SystemTime) -> bool {
    std::fs::read_dir(project).into_iter().flatten().flatten().any(|s| {
        let sub = s.path().join("subagents");
        sub.is_dir()
            && walkdir::WalkDir::new(sub)
                .into_iter()
                .flatten()
                .any(|e| e.path().extension().is_some_and(|x| x == "jsonl") && fresh(e.path(), now))
    })
}

/// Auf Akku unter 20 %: nicht wach halten (zugeklappt in der Tasche liefe er sonst leer).
fn low_battery() -> bool {
    battery().is_some_and(|(on_ac, pct)| !on_ac && pct < 20)
}

/// "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=…)\t14%; discharging; …" -> (am Netzteil, Prozent).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_pmset_batt(s: &str) -> Option<(bool, u8)> {
    let pct = s.split(|c: char| c.is_whitespace() || c == ';').find_map(|w| w.strip_suffix('%')?.parse().ok())?;
    Some((s.contains("'AC Power'"), pct))
}

#[cfg(target_os = "macos")]
fn battery() -> Option<(bool, u8)> {
    let o = crate::quiet("pmset").args(["-g", "batt"]).output().ok()?;
    parse_pmset_batt(&String::from_utf8_lossy(&o.stdout))
}

#[cfg(target_os = "linux")]
fn battery() -> Option<(bool, u8)> {
    let (mut mains, mut draining, mut pcts) = (None, false, Vec::new());
    for e in std::fs::read_dir("/sys/class/power_supply").ok()?.flatten() {
        let read = |f: &str| std::fs::read_to_string(e.path().join(f)).map(|s| s.trim().to_string()).unwrap_or_default();
        match read("type").as_str() {
            // Netzteil: online sagt verlaesslich, ob Strom anliegt (mehrere Netzteile/USB-C: eins genuegt).
            "Mains" => mains = Some(mains.unwrap_or(false) || read("online") == "1"),
            // Nur Laptop-Akkus (auch zwei, z. B. ThinkPad BAT0+BAT1), nicht der einer Funkmaus (hidpp_battery_0 …).
            "Battery" if e.file_name().to_string_lossy().starts_with("BAT") => {
                draining |= read("status") == "Discharging";
                pcts.extend(read("capacity").parse::<u32>().ok());
            }
            _ => {}
        }
    }
    if pcts.is_empty() {
        return None;
    }
    let pct = (pcts.iter().sum::<u32>() / pcts.len() as u32).min(100) as u8;
    // Ohne Netzteil-Eintrag: am Netz, solange kein Akku entlaedt.
    Some((mains.unwrap_or(!draining), pct))
}

#[cfg(windows)]
fn battery() -> Option<(bool, u8)> {
    #[repr(C)]
    #[derive(Default)]
    struct Status {
        ac: u8,
        flag: u8,
        percent: u8,
        saver: u8,
        life: u32,
        full: u32,
    }
    extern "system" {
        fn GetSystemPowerStatus(s: *mut Status) -> i32;
    }
    let mut s = Status::default();
    // 255 = unbekannt (Desktop ohne Akku).
    (unsafe { GetSystemPowerStatus(&mut s) } != 0 && s.percent != 255).then_some((s.ac == 1, s.percent))
}

/// Windows: Leerlauf-Schlaf nebenbei verhindern, solange gehalten wird (gilt fuer diesen Thread).
#[cfg(windows)]
fn keep_idle_awake(on: bool) {
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    const CONTINUOUS: u32 = 0x8000_0000;
    const SYSTEM: u32 = 0x0000_0001;
    unsafe { SetThreadExecutionState(if on { CONTINUOUS | SYSTEM } else { CONTINUOUS }) };
}

#[cfg(not(windows))]
fn keep_idle_awake(_: bool) {}

// ---------- Linux ----------

#[cfg(target_os = "linux")]
fn hold(_: &Path) -> Result<Hold, String> {
    // quiet(): im AppImage sonst mit dessen LD_LIBRARY_PATH gestartet.
    let mut c = crate::quiet("systemd-inhibit")
        .args(["--what=handle-lid-switch:sleep:idle", "--mode=block", "--who=L'Atelier de Claude", "--why=Claude arbeitet", "cat"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Wach-Halt nicht möglich (systemd-inhibit): {e}"))?;
    std::thread::sleep(Duration::from_millis(300));
    // Polkit verweigert oder kein logind: endet sofort.
    if let Ok(Some(s)) = c.try_wait() {
        return Err(format!("Wach-Halt nicht möglich: systemd-inhibit beendet ({s})"));
    }
    Ok(Hold(Some(c)))
}

#[cfg(target_os = "linux")]
fn release(h: Hold, _: &Path) {
    // stdin zu -> cat endet -> Inhibitor weg; logind prueft den Deckel erneut und legt schlafen.
    if let Hold(Some(mut c)) = h {
        drop(c.stdin.take());
        let _ = c.wait();
    }
}

#[cfg(target_os = "linux")]
fn recover(_: &Path) -> Result<(), String> {
    Ok(())
}

// ---------- macOS ----------

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOServiceMatching(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn IOServiceGetMatchingService(main: u32, matching: *mut std::ffi::c_void) -> u32;
    fn IOServiceOpen(service: u32, task: u32, kind: u32, conn: *mut u32) -> i32;
    fn IOConnectCallScalarMethod(conn: u32, sel: u32, input: *const u64, n: u32, out: *mut u64, out_n: *mut u32) -> i32;
    fn IOServiceClose(conn: u32) -> i32;
    fn IOObjectRelease(obj: u32) -> i32;
    static mach_task_self_: u32;
}

/// Deckel-Schlaf im Kernel aus-/einschalten: IOPMrootDomain, kPMSetClamshellSleepState (12), ohne Root
/// (wie Clamshell u. a.; xnu RootDomainUserClient prueft hier keine Rechte). Gilt auch auf Akku und laesst den
/// normalen Schlaf unangetastet. Wieder eingeschaltet bei geschlossenem Deckel prueft der Kernel neu und schlaeft.
#[cfg(target_os = "macos")]
fn clamshell_sleep_disabled(on: bool) -> Result<(), String> {
    unsafe {
        let s = IOServiceGetMatchingService(0, IOServiceMatching(c"IOPMrootDomain".as_ptr()));
        if s == 0 {
            return Err("IOPMrootDomain nicht gefunden".into());
        }
        let mut c = 0;
        let mut r = IOServiceOpen(s, mach_task_self_, 0, &mut c);
        if r == 0 {
            r = IOConnectCallScalarMethod(c, 12, &(on as u64), 1, std::ptr::null_mut(), std::ptr::null_mut());
            IOServiceClose(c);
        }
        IOObjectRelease(s);
        if r == 0 { Ok(()) } else { Err(format!("Deckel-Schlaf nicht steuerbar (IOKit {r:#x})")) }
    }
}

/// Hilfsprozess (`--lid-guard`, aus main.rs): der Kernel-Schalter ist global und ueberlebt unseren Prozess. Der Waechter
/// haelt ihn, bis seine stdin endet (Freigabe oder App-Absturz), und schaltet dann zurueck. caffeinate -i verhindert
/// solange auch den Leerlauf-Schlaf und endet mit dem Waechter.
#[cfg(target_os = "macos")]
pub fn lid_guard() {
    let _idle = std::process::Command::new("/usr/bin/caffeinate").args(["-i", "-w", &std::process::id().to_string()]).spawn();
    if let Err(e) = clamshell_sleep_disabled(true) {
        eprintln!("{e}");
        std::process::exit(1);
    }
    // Ohne echten Clamshell-Modus (externer Monitor) laesst macOS das Display zugeklappt an: selbst abschalten.
    // Wiederholt, falls es zwischendurch aufwacht; schlafend ist displaysleepnow wirkungslos.
    std::thread::spawn(|| loop {
        if lid_closed() {
            let _ = std::process::Command::new("/usr/bin/pmset").arg("displaysleepnow").status();
        }
        std::thread::sleep(Duration::from_secs(2));
    });
    let _ = std::io::copy(&mut std::io::stdin(), &mut std::io::sink());
    let _ = clamshell_sleep_disabled(false);
}

#[cfg(target_os = "macos")]
fn lid_closed() -> bool {
    std::process::Command::new("/usr/sbin/ioreg")
        .args(["-r", "-k", "AppleClamshellState", "-d", "1"])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains("\"AppleClamshellState\" = Yes"))
}

#[cfg(target_os = "macos")]
fn hold(_: &Path) -> Result<Hold, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut c = std::process::Command::new(exe)
        .arg("--lid-guard")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Wach-Halt nicht möglich: {e}"))?;
    std::thread::sleep(Duration::from_millis(300));
    if let Ok(Some(_)) = c.try_wait() {
        let mut err = String::new();
        let _ = std::io::Read::read_to_string(c.stderr.as_mut().expect("piped"), &mut err);
        return Err(format!("Wach-Halt nicht möglich: {}", err.trim()));
    }
    Ok(Hold(Some(c)))
}

#[cfg(target_os = "macos")]
fn release(h: Hold, _: &Path) {
    if let Hold(Some(mut c)) = h {
        drop(c.stdin.take());
        let _ = c.wait();
    }
}

/// Waechter hart beendet (kill -9, Abmelden): Schalter beim naechsten Start zuruecksetzen. Bis Version 1.4.3 lief
/// stattdessen ein Root-Waechter mit `pmset disablesleep`; liegt dessen armed-Datei noch, ggf. Reset-Hinweis.
#[cfg(target_os = "macos")]
fn recover(m: &Path) -> Result<(), String> {
    let _ = clamshell_sleep_disabled(false);
    let armed = m.with_extension("armed");
    if std::fs::remove_file(&armed).is_err() {
        return Ok(());
    }
    let o = crate::quiet("pmset").arg("-g").output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    if o.lines().any(|l| l.split_whitespace().eq(["SleepDisabled", "1"])) {
        return Err("Schlaf ist noch deaktiviert (ältere Version). Zurücksetzen im Terminal: sudo pmset -a disablesleep 0".into());
    }
    Ok(())
}

// ---------- Windows ----------

/// `powercfg /q … LIDACTION`: die letzten beiden Hex-Werte sind AC und DC (Ausgabe ist lokalisiert).
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_lidaction(s: &str) -> Option<(u32, u32)> {
    let hex: Vec<u32> = s
        .lines()
        .filter_map(|l| l.trim().rsplit(' ').next()?.strip_prefix("0x").and_then(|h| u32::from_str_radix(h, 16).ok()))
        .collect();
    let n = hex.len();
    (n >= 2).then(|| (hex[n - 2], hex[n - 1]))
}

#[cfg(windows)]
fn powercfg(args: &[&str]) -> Result<String, String> {
    let o = crate::quiet("powercfg").args(args).output().map_err(|e| e.to_string())?;
    if !o.status.success() {
        return Err(format!("powercfg {}: {}", args.join(" "), String::from_utf8_lossy(&o.stdout).trim()));
    }
    Ok(String::from_utf8_lossy(&o.stdout).into_owned())
}

#[cfg(windows)]
fn set_lid(ac: u32, dc: u32) -> Result<(), String> {
    powercfg(&["/setacvalueindex", "SCHEME_CURRENT", "SUB_BUTTONS", "LIDACTION", &ac.to_string()])?;
    powercfg(&["/setdcvalueindex", "SCHEME_CURRENT", "SUB_BUTTONS", "LIDACTION", &dc.to_string()])?;
    powercfg(&["/setactive", "SCHEME_CURRENT"]).map(|_| ())
}

#[cfg(windows)]
fn lid() -> Result<(u32, u32), String> {
    parse_lidaction(&powercfg(&["/q", "SCHEME_CURRENT", "SUB_BUTTONS", "LIDACTION"])?).ok_or_else(|| "Deckel-Aktion nicht lesbar".into())
}

#[cfg(windows)]
fn hold(m: &Path) -> Result<Hold, String> {
    let (ac, dc) = lid()?;
    std::fs::create_dir_all(m.parent().ok_or("kein Datenordner")?).map_err(|e| e.to_string())?;
    // Alter Wert vor dem Eingriff auf die Platte: nach einem Absturz stellt recover ihn wieder her.
    std::fs::write(m, format!("{ac} {dc}")).map_err(|e| e.to_string())?;
    if let Err(e) = set_lid(0, 0).and_then(|()| lid()).and_then(|v| if v == (0, 0) { Ok(()) } else { Err("von einer Richtlinie gesperrt".into()) }) {
        let _ = set_lid(ac, dc);
        let _ = std::fs::remove_file(m);
        return Err(format!("Deckel-Aktion nicht änderbar: {e}"));
    }
    Ok(Hold(None))
}

#[cfg(windows)]
fn release(_: Hold, m: &Path) {
    restore(m);
}

#[cfg(windows)]
fn restore(m: &Path) {
    let Some((ac, dc)) = std::fs::read_to_string(m).ok().and_then(|s| {
        let mut it = s.split_whitespace().map(|x| x.parse::<u32>().ok());
        Some((it.next()??, it.next()??))
    }) else {
        return;
    };
    // Nur zuruecksetzen, solange noch unser Wert steht; hat der User inzwischen selbst umgestellt, gilt seiner.
    if lid().is_ok_and(|v| v == (0, 0)) {
        let _ = set_lid(ac, dc);
    }
    let _ = std::fs::remove_file(m);
}

#[cfg(windows)]
fn recover(m: &Path) -> Result<(), String> {
    restore(m);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_busy_nur_frisch() {
        let dir = std::env::temp_dir().join(format!("ocui-awake-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let now = SystemTime::now();
        assert!(!busy_panel(&dir, now));
        std::fs::write(dir.join("a.json"), r#"{"busy":false}"#).unwrap();
        std::fs::write(dir.join("b.json"), "kaputt").unwrap();
        assert!(!busy_panel(&dir, now));
        std::fs::write(dir.join("c.json"), r#"{"busy":true}"#).unwrap();
        assert!(busy_panel(&dir, now));
        // Heartbeat ausgeblieben (claude abgestuerzt): zaehlt nicht mehr.
        assert!(!busy_panel(&dir, now + Duration::from_secs(120)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn agents_nur_frische_transkripte() {
        let dir = std::env::temp_dir().join(format!("ocui-awake-ag-{}", std::process::id()));
        let wf = dir.join("sess/subagents/workflows/wf_1");
        std::fs::create_dir_all(&wf).unwrap();
        let now = SystemTime::now();
        assert!(!agents_recent_in(&dir, now));
        std::fs::write(wf.join("agent-x.jsonl"), "{}").unwrap();
        assert!(agents_recent_in(&dir, now));
        assert!(!agents_recent_in(&dir, now + Duration::from_secs(120)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn zeichnen_nur_bei_dauerausgabe() {
        let now = Instant::now();
        let at = |ms: &[u64]| ms.iter().map(|m| now - Duration::from_millis(*m)).collect::<VecDeque<_>>();
        // Spinner: alle 100 ms.
        assert!(drawing(&at(&(0..30).map(|i| i * 100).collect::<Vec<_>>()), now));
        // Einzelnes Neuzeichnen (Uhr alle 30 s) und alte Ausgabe zaehlen nicht.
        assert!(!drawing(&at(&[0, 50, 100]), now));
        assert!(!drawing(&at(&(0..30).map(|i| 11_000 + i * 100).collect::<Vec<_>>()), now));
    }

    #[test]
    fn akku_aus_pmset() {
        let bat = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123)\t14%; discharging; 1:02 remaining present: true\n";
        assert_eq!(parse_pmset_batt(bat), Some((false, 14)));
        let ac = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=123)\t100%; charged; 0:00 remaining present: true\n";
        assert_eq!(parse_pmset_batt(ac), Some((true, 100)));
        assert_eq!(parse_pmset_batt("Now drawing from 'AC Power'\n"), None);
    }

    #[test]
    fn deckel_aktion_aus_powercfg() {
        let de = "Energieschema-GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Ausbalanciert)\n  Untergruppen-GUID: 4f971e89-eebd-4455-a8de-9e59040e7347  (Netzschalter und Zuklappen)\n    Energieeinstellungs-GUID: 5ca83367-6e45-459f-a27b-476b1d01c936  (Zuklappaktion)\n      Mögliche Einstellung: 000\n      Aktueller Wechselstrom-Energieeinstellungsindex: 0x00000001\n      Aktueller Gleichstrom-Energieeinstellungsindex: 0x00000003\n";
        assert_eq!(parse_lidaction(de), Some((1, 3)));
        let en = "    Current AC Power Setting Index: 0x00000000\n    Current DC Power Setting Index: 0x00000001\n";
        assert_eq!(parse_lidaction(en), Some((0, 1)));
        assert_eq!(parse_lidaction("nichts"), None);
    }
}
