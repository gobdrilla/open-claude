// Aktivitaets-Panel: Workflows und Bilder der laufenden Claude-Session, nur aus dem, was Claude Code
// ohnehin unter ~/.claude schreibt. Undokumentierte Formate: fehlende Felder bleiben leer, nie Fehler.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::git::blocking;

#[derive(Serialize, Clone, Debug)]
pub struct Activity {
    session: Option<String>,
    /// claude laeuft in diesem cwd (sessions/*.json); sonst ist session nur das neueste Transkript
    alive: bool,
    runs: Vec<Run>,
    /// Agents aus dem Agent-Tool (ausserhalb von Workflows); label = description, phase = agentType
    agents: Vec<Agent>,
    images: Vec<Img>,
    /// Eigene Prompts der Session (origin.kind = human), aelteste zuerst
    prompts: Vec<Prompt>,
    /// Session-Daten der eingebauten Mod (siehe panel_file), unveraendert durchgereicht.
    panel: Option<Value>,
    /// Neueste Rate-Limits aller Sessions, siehe newest_limits()
    limits: Option<Value>,
    /// Aktive Plugin-Modi (caveman, ponytail, ...), siehe modes()
    modes: Vec<Mode>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Mode {
    name: String,
    level: String,
}

/// Plugins wie caveman/ponytail legen ~/.claude/.<name>-active mit der Stufe an und loeschen sie beim
/// Abschalten (ihre Statuszeilen lesen dieselbe Datei). Gilt fuer alle Sessions, nicht nur diese.
fn modes(c: &Path) -> Vec<Mode> {
    let mut out: Vec<Mode> = fs::read_dir(c)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let name = e.file_name().to_str()?.strip_prefix('.')?.strip_suffix("-active")?.to_string();
            let level = fs::read_to_string(e.path()).unwrap_or_default();
            (!name.is_empty()).then(|| Mode { name, level: trunc(level.trim(), 20) })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Datei, in die die Mod im Terminal `id` ihr Panel-Atom schreibt (Env OPEN_CLAUDE_PANEL).
pub fn panel_file(id: &str) -> PathBuf {
    std::env::temp_dir().join("open-claude-panel").join(format!("{id}.json"))
}

/// Limits gelten fuers ganze Konto, kommen aber erst mit einer API-Antwort: neueste Panel-Datei mit Limits nehmen,
/// damit sie vor der ersten Nachricht da sind und Antworten anderer Sessions sie auffrischen.
fn newest_limits(dir: &Path) -> Option<Value> {
    let mut files: Vec<_> = fs::read_dir(dir).ok()?.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files.into_iter().find_map(|(_, p)| {
        let v: Value = serde_json::from_str(&fs::read_to_string(p).ok()?).ok()?;
        v.get("limits").filter(|l| l.as_array().is_some_and(|a| !a.is_empty())).cloned()
    })
}

#[derive(Serialize, Clone, Debug)]
pub struct Run {
    id: String,
    name: String,
    /// running|completed|failed|killed|aborted
    status: String,
    started: u64,
    duration_ms: u64,
    tokens: u64,
    phases: Vec<String>,
    /// Geplante Agents je Phase (gleicher Index, 0 = unbekannt); nur laufende Runs
    planned: Vec<u32>,
    agents: Vec<Agent>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Agent {
    id: String,
    label: String,
    phase: String,
    /// running|done|error|aborted
    state: String,
    started: u64,
    last_at: u64,
    tokens: u64,
    tool_calls: u32,
    steps: Vec<Step>,
    text: Option<String>,
    result: Option<String>,
    /// Auftrag ohne Harness-Vorspann, gekuerzt
    prompt: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Step {
    at: u64,
    tool: String,
    summary: String,
}

/// Ein Eintrag der Agent-Zeitleiste (claude_agent_log).
#[derive(Serialize, Clone, Debug, Default)]
pub struct Entry {
    at: u64,
    /// prompt|text|tool
    kind: &'static str,
    tool: String,
    summary: String,
    /// Prompt/Text bzw. Tool-Eingabe, gekuerzt
    body: String,
    /// Ergebnis des Tool-Calls; None solange er laeuft
    output: Option<String>,
    error: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Img {
    id: usize,
    at: u64,
    kind: String,
    label: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Prompt {
    at: u64,
    text: String,
}

#[derive(Clone)]
struct ImgRef {
    path: PathBuf,
    offset: u64,
    nth: usize,
}

/// Zwischenstand eines Agent-Transkripts, inkrementell fortgeschrieben.
#[derive(Default, Clone)]
struct Sum {
    tokens: u64,
    tool_calls: u32,
    started: u64,
    last_at: u64,
    steps: Vec<Step>,
    text: Option<String>,
    prompt: Option<String>,
}

#[derive(Default)]
struct State {
    offsets: HashMap<PathBuf, u64>,
    /// eigene Offsets, weil Agent-Transkripte auch fuer Bilder gescannt werden
    sum_offsets: HashMap<PathBuf, u64>,
    reads: HashMap<PathBuf, HashMap<String, String>>,
    hashes: HashSet<u64>,
    imgs: Vec<(ImgRef, Img)>,
    prompts: Vec<Prompt>,
    sums: HashMap<PathBuf, Sum>,
    done: HashMap<String, Run>,
    /// agentId -> (Zeitpunkt, Endstatus) aus dem Haupttranskript, siehe ended()
    ended: HashMap<String, (u64, String)>,
    /// Letzter Zugriff, fuer die Verdraengung im Cache
    used: u64,
}

/// Cache pro Session-ID: Tab-Wechsel liest nichts neu, Bild-ids bleiben je Session stabil.
type Cache = HashMap<String, State>;
static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(Default::default);

const IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

pub(crate) fn config_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| crate::skills::home().join(".claude"))
}

/// Pfad, wie claude ihn sieht: realpath mit echter Schreibweise (Dev -> dev, /tmp -> /private/tmp), Windows ohne "\\?\".
pub(crate) fn real(cwd: &str) -> String {
    fs::canonicalize(cwd).map_or_else(|_| cwd.into(), |p| p.to_string_lossy().trim_start_matches(r"\\?\").into())
}

pub(crate) fn slug(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

pub(crate) fn ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// "2026-10-08T19:03:10.208Z" -> epoch ms (nur UTC-Z, wie Claude Code schreibt); sonst 0.
fn iso_ms(s: &str) -> u64 {
    let n = |a: usize, b: usize| s.get(a..b).and_then(|x| x.parse::<i64>().ok());
    let (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(sec)) = (n(0, 4), n(5, 7), n(8, 10), n(11, 13), n(14, 16), n(17, 19))
    else {
        return 0;
    };
    let frac = s.get(19..).and_then(|r| r.strip_prefix('.')).map_or(0, |r| {
        let digits: String = r.chars().take_while(char::is_ascii_digit).take(3).collect();
        format!("{digits:0<3}").parse::<i64>().unwrap_or(0)
    });
    // Tage seit 1970 (Howard Hinnant, days_from_civil)
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((mo + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    (((days * 24 + h) * 60 + mi) * 60 + sec) as u64 * 1000 + frac as u64
}

pub(crate) fn trunc(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n - 1).chain(['…']).collect()
    }
}

pub(crate) fn str_of<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

fn u64_of(v: &Value, k: &str) -> u64 {
    v.get(k).and_then(Value::as_u64).unwrap_or(0)
}

/// Neue vollstaendige Zeilen ab dem gemerkten Offset an f; eine halbe letzte Zeile bleibt fuer den naechsten Scan.
/// Zeilenweise gestreamt: Transkripte mit Bildern haben oft 100+ MB, ganz eingelesen lag das doppelt im Speicher.
fn new_lines(path: &Path, offsets: &mut HashMap<PathBuf, u64>, mut f: impl FnMut(u64, &str)) {
    let Ok(mut file) = File::open(path) else { return };
    let len = file.metadata().map_or(0, |m| m.len());
    let off = offsets.entry(path.to_path_buf()).or_insert(0);
    if len < *off {
        *off = 0; // Datei neu geschrieben
    }
    if len == *off || file.seek(SeekFrom::Start(*off)).is_err() {
        return;
    }
    let mut r = BufReader::new(file);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(n) if n > 0 && buf.ends_with(b"\n") => {
                f(*off, &String::from_utf8_lossy(&buf[..n - 1]));
                *off += n as u64;
            }
            _ => return,
        }
    }
}

/// Bild-Quellen {type:image, source:{type:base64,...}} in Dokumentreihenfolge, mit umgebender tool_use_id.
fn images<'a>(v: &'a Value, tid: Option<&'a str>, out: &mut Vec<(&'a Value, Option<&'a str>)>) {
    match v {
        Value::Object(m) => {
            if str_of(v, "type") == "image" {
                if let Some(src) = m.get("source").filter(|s| str_of(s, "type") == "base64" && s.get("data").is_some_and(Value::is_string)) {
                    out.push((src, tid));
                    return;
                }
            }
            let tid = m.get("tool_use_id").and_then(Value::as_str).or(tid);
            for x in m.values() {
                images(x, tid, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|x| images(x, tid, out)),
        _ => {}
    }
}

fn content(v: &Value) -> &[Value] {
    v.pointer("/message/content").and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn scan_images(st: &mut State, path: &Path) {
    new_lines(path, &mut st.offsets, |offset, line| {
        if let Some((id, at, status)) = ended(line) {
            st.ended.insert(id, (at, status));
        }
        if line.contains("\"name\":\"Read\"") {
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                let map = st.reads.entry(path.to_path_buf()).or_default();
                for c in content(&v).iter().filter(|c| str_of(c, "type") == "tool_use" && str_of(c, "name") == "Read") {
                    if let Some(p) = c.pointer("/input/file_path").and_then(Value::as_str) {
                        map.insert(str_of(c, "id").to_string(), p.to_string());
                    }
                }
            }
        }
        // Agent-Transkripte (isSidechain) koennen die weitergereichte Anfrage ebenfalls als human tragen.
        if line.contains("\"origin\":{\"kind\":\"human\"") {
            if let Some(v) = serde_json::from_str::<Value>(line).ok().filter(|v| v.get("isSidechain") != Some(&Value::Bool(true))) {
                let c = v.pointer("/message/content");
                let text = c.and_then(Value::as_str).or_else(|| c?.as_array()?.iter().find(|x| str_of(x, "type") == "text")?.get("text")?.as_str());
                if let Some(t) = text.map(str::trim).filter(|t| !t.is_empty()) {
                    st.prompts.push(Prompt { at: iso_ms(str_of(&v, "timestamp")), text: trunc(t, 2000) });
                }
            }
        }
        if !line.contains("\"type\":\"image\"") {
            return;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { return };
        let mut found = Vec::new();
        images(&v, None, &mut found);
        let paste = v.get("imagePasteIds").or(v.pointer("/attachment/imagePasteIds")).and_then(Value::as_array);
        let at = iso_ms(str_of(&v, "timestamp"));
        for (nth, (src, tid)) in found.into_iter().enumerate() {
            let mut h = DefaultHasher::new();
            str_of(src, "data").hash(&mut h);
            if !st.hashes.insert(h.finish()) {
                continue;
            }
            let read = tid.and_then(|t| st.reads.get(path)?.get(t));
            let (kind, label) = match (paste, read) {
                (Some(ids), _) => ("paste", format!("Eingefügt #{}", ids.get(nth).and_then(Value::as_u64).unwrap_or(nth as u64 + 1))),
                (None, Some(p)) => ("read", p.clone()),
                _ => ("other", "Bild".to_string()),
            };
            let id = st.imgs.len();
            st.imgs.push((
                ImgRef { path: path.to_path_buf(), offset, nth },
                Img { id, at, kind: kind.into(), label },
            ));
        }
    });
}

/// Ende eines Agent-Tool-Agents: <task-notification> (Hintergrund) oder toolUseResult mit agentId (Vordergrund).
fn ended(line: &str) -> Option<(String, u64, String)> {
    let note = line.contains("\"content\":\"<task-notification>");
    if !note && !line.contains("\"toolUseResult\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let (id, status) = if note {
        let tag = |t: &str| Some(line.split_once(&format!("<{t}>"))?.1.split_once(&format!("</{t}>"))?.0.to_string());
        (tag("task-id")?, tag("status")?)
    } else {
        let r = v.get("toolUseResult")?;
        (r.get("agentId")?.as_str()?.to_string(), str_of(r, "status").to_string())
    };
    let status = match status.as_str() {
        "completed" => "done",
        "failed" | "error" => "error",
        "killed" | "stopped" => "killed",
        _ => return None, // async_launched u. a.: laeuft noch
    };
    Some((id, iso_ms(str_of(&v, "timestamp")), status.into()))
}

/// Agent-Tool-Agent aus subagents/agent-<id>.jsonl + .meta.json; Status aus st.ended, sonst laeuft er mit der Session.
fn solo(st: &mut State, path: &Path, alive: bool) -> Option<Agent> {
    let id = path.file_stem()?.to_str()?.strip_prefix("agent-")?.to_string();
    if !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return None;
    }
    let meta: Value = fs::read_to_string(path.with_extension("meta.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let s = sum_agent(st, path);
    let state = match st.ended.get(&id) {
        // Fortgesetzter Agent schreibt nach der Meldung weiter: laeuft wieder
        Some((at, end)) if *at >= s.last_at || !alive => end.clone(),
        _ if alive => "running".into(),
        _ => "aborted".into(),
    };
    Some(Agent {
        label: str_of(&meta, "description").into(),
        phase: str_of(&meta, "agentType").into(),
        id,
        state,
        started: s.started,
        last_at: s.last_at,
        tokens: s.tokens,
        tool_calls: s.tool_calls,
        steps: s.steps,
        text: s.text,
        result: None,
        prompt: s.prompt,
    })
}

fn step(c: &Value, at: u64) -> Step {
    let input = c.get("input").unwrap_or(&Value::Null);
    let summary = ["command", "file_path", "pattern", "url", "query", "description", "skill"]
        .iter()
        .find_map(|k| input.get(k).and_then(Value::as_str))
        .unwrap_or("");
    Step { at, tool: str_of(c, "name").to_string(), summary: trunc(summary.lines().next().unwrap_or(""), 120) }
}

const LOG_CHARS: usize = 4000;
const PROMPT_CHARS: usize = 20000;

/// Workflow-Agenten bekommen den Auftrag hinter einer Harness-Kopfzeile, jede Zeile um zwei Leerzeichen eingerueckt.
fn task(s: &str) -> String {
    let Some((_, body)) = s.strip_prefix("[Workflow harness").and_then(|r| r.split_once('\n')) else { return s.trim().into() };
    body.lines().map(|l| l.strip_prefix("  ").unwrap_or(l)).collect::<Vec<_>>().join("\n").trim().into()
}

/// Workflow-Agenten bekommen vor dem Auftrag die Anfrage weitergereicht, die den Run ausgeloest hat.
fn relayed(t: &str) -> bool {
    t.starts_with("[Workflow harness — user request]")
}

/// Auftrag aus einer Transkript-Zeile {type:user, message:{content:"..."}}; None fuer die weitergereichte Anfrage.
fn prompt_of(v: &Value) -> Option<String> {
    let t = v.pointer("/message/content").and_then(Value::as_str).filter(|t| str_of(v, "type") == "user" && !relayed(t))?;
    Some(trunc(&task(t), PROMPT_CHARS))
}

/// Nur die ersten zwei Zeilen lesen: fertige Runs brauchen vom Transkript nur den Auftrag.
fn first_prompt(path: &Path) -> Option<String> {
    BufReader::new(File::open(path).ok()?).lines().take(2).map_while(Result::ok).find_map(|l| prompt_of(&serde_json::from_str(&l).ok()?))
}

/// Ganzes Agent-Transkript als Zeitleiste: Auftrag, Texte, Tool-Calls samt Ergebnis.
// ponytail: liest bei jedem Aufruf die ganze Datei; inkrementell wie sum_agent erst wenn es bremst
fn agent_log(path: &Path) -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::new();
    let mut calls: HashMap<String, usize> = HashMap::new();
    for line in fs::read_to_string(path).unwrap_or_default().lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let at = iso_ms(str_of(&v, "timestamp"));
        match str_of(&v, "type") {
            "user" => {
                // Erste Nutzer-Nachricht als Text ist der Auftrag; spaetere Strings sind Harness-Rauschen.
                if let Some(t) = v.pointer("/message/content").and_then(Value::as_str) {
                    if out.is_empty() && !relayed(t) {
                        out.push(Entry { at, kind: "prompt", body: trunc(&task(t), LOG_CHARS), ..Default::default() });
                    }
                    continue;
                }
                for c in content(&v).iter().filter(|c| str_of(c, "type") == "tool_result") {
                    let Some(&i) = calls.get(str_of(c, "tool_use_id")) else { continue };
                    let text = match c.get("content") {
                        Some(Value::String(s)) => s.clone(),
                        Some(Value::Array(a)) => a.iter().map(|x| str_of(x, "text")).collect::<Vec<_>>().join("\n"),
                        _ => String::new(),
                    };
                    out[i].output = Some(trunc(text.trim_end(), LOG_CHARS));
                    out[i].error = c.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                }
            }
            "assistant" => {
                for c in content(&v) {
                    match str_of(c, "type") {
                        "text" if !str_of(c, "text").trim().is_empty() => {
                            out.push(Entry { at, kind: "text", body: trunc(str_of(c, "text"), LOG_CHARS), ..Default::default() })
                        }
                        "tool_use" => {
                            let s = step(c, at);
                            let input = c.get("input").map(|i| serde_json::to_string_pretty(i).unwrap_or_default()).unwrap_or_default();
                            calls.insert(str_of(c, "id").into(), out.len());
                            out.push(Entry { at, kind: "tool", tool: s.tool, summary: s.summary, body: trunc(&input, LOG_CHARS), ..Default::default() });
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Pfadteile kommen vom Frontend: nur erwartete Zeichen, damit kein ../ durchrutscht.
#[tauri::command]
pub async fn claude_agent_log(cwd: String, sid: String, run: String, agent: String) -> Result<Vec<Entry>, String> {
    let ok = |s: &str, f: fn(&u8) -> bool| !s.is_empty() && s.bytes().all(|b| f(&b));
    let valid = ok(&sid, |b| b.is_ascii_hexdigit() || *b == b'-')
        // leerer run = Agent-Tool-Agent direkt in subagents/
        && (run.is_empty() || run.starts_with("wf_") && ok(&run, |b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-'))
        && ok(&agent, u8::is_ascii_alphanumeric);
    if !valid {
        return Err("Ungueltige Kennung".into());
    }
    blocking(move || {
        let proj = config_dir().join("projects").join(slug(&real(&cwd)));
        let sub = PathBuf::from("subagents");
        let rel = if run.is_empty() { sub } else { sub.join("workflows").join(&run) }.join(format!("agent-{agent}.jsonl"));
        // Nach /clear zeigt das Panel auch Agents frueherer Sessions (siehe earlier): dann die neueste Datei mit der id.
        let own = proj.join(&sid).join(&rel);
        let f = fs::read_dir(&proj)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let f = e.path().join(&rel);
                Some((fs::metadata(&f).ok()?.modified().ok()?, f))
            })
            .max_by_key(|x| x.0)
            .map_or(own, |x| x.1);
        Ok(agent_log(&f))
    })
    .await
}

fn sum_agent(st: &mut State, path: &Path) -> Sum {
    let s = st.sums.entry(path.to_path_buf()).or_default();
    new_lines(path, &mut st.sum_offsets, |off, line| {
        if off == 0 || s.prompt.is_none() && line.contains("[Workflow harness") {
            s.prompt = serde_json::from_str(line).ok().as_ref().and_then(prompt_of);
        }
        if !line.contains("\"type\":\"assistant\"") {
            return;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { return };
        if str_of(&v, "type") != "assistant" {
            return;
        }
        let at = iso_ms(str_of(&v, "timestamp"));
        if s.started == 0 {
            s.started = at;
        }
        s.last_at = s.last_at.max(at);
        // Zeilen derselben message.id tragen dieselbe usage: letzte nehmen, nicht summieren.
        if let Some(u) = v.pointer("/message/usage") {
            s.tokens = u64_of(u, "input_tokens") + u64_of(u, "cache_read_input_tokens") + u64_of(u, "cache_creation_input_tokens");
        }
        for c in content(&v) {
            match str_of(c, "type") {
                "tool_use" => {
                    s.tool_calls += 1;
                    s.steps.push(step(c, at));
                    if s.steps.len() > 5 {
                        s.steps.remove(0);
                    }
                }
                "text" if !str_of(c, "text").trim().is_empty() => s.text = Some(trunc(str_of(c, "text"), 500)),
                _ => {}
            }
        }
    });
    s.clone()
}

/// Name aus <name>-<runId>.js, Phasen aus den title:-Zeilen des meta-Blocks.
fn script_meta(dir: &Path, run: &str) -> (Option<String>, Vec<(String, u32)>) {
    let suffix = format!("-{run}.js");
    let Some(file) = fs::read_dir(dir).ok().and_then(|rd| {
        rd.flatten().map(|e| e.path()).find(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(&suffix)))
    }) else {
        return (None, vec![]);
    };
    let name = file.file_name().and_then(|n| n.to_str()).map(|n| n.trim_end_matches(&suffix).to_string());
    (name, phases_of(&fs::read_to_string(&file).unwrap_or_default()))
}

/// (Titel, geplante Agents): Zahl am Anfang von detail ('3 parallel readers'), sonst 0.
fn phases_of(script: &str) -> Vec<(String, u32)> {
    let mut out = Vec::new();
    let mut inside = false;
    for line in script.lines() {
        if line.contains("export const meta") {
            inside = true;
        } else if inside && line == "}" {
            break;
        }
        if !inside {
            continue;
        }
        let Some(rest) = line.split_once("title:").map(|x| x.1.trim_start()) else { continue };
        let Some(q) = rest.chars().next().filter(|c| matches!(c, '\'' | '"' | '`')) else { continue };
        if let Some(t) = rest[1..].split(q).next() {
            let n = line
                .split_once("detail:")
                .and_then(|x| x.1.trim_start().get(1..))
                .map_or(0, |d| d.chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0));
            out.push((t.to_string(), n));
        }
    }
    out
}

/// dir = subagents/workflows/<id> mit den Agent-Transkripten (fuer den vollen Auftrag).
fn finished(v: &Value, id: &str, dir: &Path) -> Run {
    let arr = |k: &str| v.get(k).and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    let agents = arr("workflowProgress")
        .iter()
        .filter(|a| str_of(a, "type") == "workflow_agent")
        .map(|a| {
            let started = u64_of(a, "startedAt");
            let last = u64_of(a, "lastProgressAt").max(started + u64_of(a, "durationMs"));
            let id = str_of(a, "agentId");
            let full = (!id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric()))
                .then(|| first_prompt(&dir.join(format!("agent-{id}.jsonl"))))
                .flatten();
            Agent {
                id: id.into(),
                label: str_of(a, "label").into(),
                phase: str_of(a, "phaseTitle").into(),
                state: match str_of(a, "state") {
                    "" => "done",
                    s => s,
                }
                .into(),
                started,
                last_at: last,
                tokens: u64_of(a, "tokens"),
                tool_calls: u64_of(a, "toolCalls") as u32,
                steps: a
                    .get("lastToolName")
                    .and_then(Value::as_str)
                    .map(|t| Step { at: last, tool: t.into(), summary: str_of(a, "lastToolSummary").into() })
                    .into_iter()
                    .collect(),
                text: None,
                result: a.get("resultPreview").and_then(Value::as_str).map(Into::into),
                prompt: full.or_else(|| a.get("promptPreview").and_then(Value::as_str).map(Into::into)),
            }
        })
        .collect();
    Run {
        id: id.into(),
        name: match str_of(v, "workflowName") {
            "" => id,
            n => n,
        }
        .into(),
        status: str_of(v, "status").into(),
        started: u64_of(v, "startTime"),
        duration_ms: u64_of(v, "durationMs"),
        tokens: u64_of(v, "totalTokens"),
        phases: arr("phases").iter().map(|p| str_of(p, "title").to_string()).collect(),
        planned: vec![],
        agents,
    }
}

/// Run aus journal.jsonl + Agent-Transkripten; alive = startedAt der lebenden Session mit dieser SID.
fn live(st: &mut State, dir: &Path, scripts: &[PathBuf], id: &str, alive: Option<u64>, now: u64) -> Run {
    let journal = dir.join("journal.jsonl");
    let created = fs::metadata(&journal).and_then(|m| m.created()).map(ms).ok();
    // Geaendert statt angelegt: ein fortgesetzter Run (z. B. nach dem Session-Limit) laeuft in einem aelteren Journal weiter.
    let modified = fs::metadata(&journal).and_then(|m| m.modified()).map(ms).ok();
    let running = alive.is_some_and(|s| modified.is_none_or(|c| s <= c));
    let mut agents: Vec<(String, Agent)> = Vec::new();
    for line in fs::read_to_string(&journal).unwrap_or_default().lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let key = str_of(&v, "key");
        let state = match str_of(&v, "type") {
            "started" => "running",
            "result" => "done",
            "failed" => "error",
            _ => continue,
        };
        let pos = agents.iter().position(|(k, _)| k == key);
        let a = match pos {
            Some(i) => &mut agents[i].1,
            None => {
                agents.push((key.into(), Agent::default()));
                &mut agents.last_mut().unwrap().1
            }
        };
        a.state = state.into();
        for (f, k) in [(&mut a.id, "agentId"), (&mut a.label, "label"), (&mut a.phase, "phase")] {
            if let Some(s) = v.get(k).and_then(Value::as_str) {
                *f = s.into();
            }
        }
        if state != "running" {
            let r = v.get("result").or(v.get("error"));
            a.result = r.map(|r| trunc(&r.as_str().map_or_else(|| r.to_string(), Into::into), 2000));
        }
    }
    // Nach /clear liegt das Skript evtl. nur bei der frueheren Session
    let (name, meta) = scripts.iter().map(|d| script_meta(d, id)).find(|m| m.0.is_some()).unwrap_or_default();
    let (mut phases, planned): (Vec<_>, Vec<_>) = meta.into_iter().unzip();
    let mut agents: Vec<Agent> = agents.into_iter().map(|x| x.1).collect();
    for a in &mut agents {
        if !a.id.is_empty() && a.id.bytes().all(|b| b.is_ascii_alphanumeric()) {
            let s = sum_agent(st, &dir.join(format!("agent-{}.jsonl", a.id)));
            (a.started, a.last_at, a.tokens, a.tool_calls, a.steps, a.text, a.prompt) = (s.started, s.last_at, s.tokens, s.tool_calls, s.steps, s.text, s.prompt);
        }
        if !running && a.state == "running" {
            a.state = "aborted".into();
        }
        if !a.phase.is_empty() && !phases.contains(&a.phase) {
            phases.push(a.phase.clone());
        }
    }
    let started = created.or(agents.iter().map(|a| a.started).filter(|&s| s > 0).min()).unwrap_or(0);
    let end = if running { now } else { agents.iter().map(|a| a.last_at).max().unwrap_or(started) };
    Run {
        id: id.into(),
        name: name.unwrap_or_else(|| id.into()),
        status: if running { "running" } else { "aborted" }.into(),
        started,
        duration_ms: end.saturating_sub(started),
        tokens: agents.iter().map(|a| a.tokens).sum(),
        phases,
        planned,
        agents,
    }
}

/// (sid, startedAt der lebenden Session, SIDs der anderen lebenden Sessions im cwd) — sessions/*.json mit passendem
/// cwd, sonst neueste Transkript-Datei.
// ponytail: zwei claude im selben cwd -> neueste gewinnt; exakt waere Kindprozess der PTY-PID
fn session(c: &Path, cwd: &str, p: &Path) -> Option<(String, Option<u64>, Vec<String>)> {
    let mut all: Vec<Value> = fs::read_dir(c.join("sessions"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_str::<Value>(&fs::read_to_string(e.path()).ok()?).ok())
        .filter(|v| str_of(v, "cwd") == cwd)
        .collect();
    all.sort_by_key(|v| u64_of(v, "updatedAt"));
    let live = all.pop();
    let others = all.iter().map(|v| str_of(v, "sessionId").to_string()).collect();
    let (sid, alive) = match live {
        Some(v) => (str_of(&v, "sessionId").to_string(), Some(u64_of(&v, "startedAt"))),
        None => {
            let newest = fs::read_dir(p)
                .ok()?
                .flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
                .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())?;
            (newest.path().file_stem()?.to_str()?.to_string(), None)
        }
    };
    (!sid.is_empty() && sid.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')).then_some((sid, alive, others))
}

/// Fruehere SIDs desselben claude-Prozesses, aelteste zuerst: /clear und /resume wechseln die SID, laufende Agents
/// und Workflows zeigt claude aber weiter. Transkripte, die seit dem Start geschrieben wurden, ohne andere lebende Sessions.
// shortcut: ein inzwischen beendetes zweites claude im selben cwd zaehlt mit; exakt waere die PID im Transkript
fn earlier(p: &Path, sid: &str, started: u64, others: &[String]) -> Vec<String> {
    let mut out: Vec<(u64, String)> = fs::read_dir(p)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let s = e.path().file_name()?.to_str()?.strip_suffix(".jsonl")?.to_string();
            let at = ms(e.metadata().ok()?.modified().ok()?);
            let ok = at >= started && s != sid && !others.contains(&s) && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-');
            ok.then_some((at, s))
        })
        .collect();
    out.sort();
    out.into_iter().rev().take(5).rev().map(|x| x.1).collect()
}

/// Derselbe Agent in zwei Sessions (nach /clear uebernommen): die neuere gewinnt, fehlende Angaben kommen aus der aelteren.
fn merge(old: &mut Agent, mut new: Agent) {
    for (n, o) in [(&mut new.label, &mut old.label), (&mut new.phase, &mut old.phase)] {
        if n.is_empty() {
            *n = std::mem::take(o);
        }
    }
    new.prompt = new.prompt.or(old.prompt.take());
    *old = new;
}

fn activity_in(cache: &mut Cache, c: &Path, cwd: &str, now: u64) -> Activity {
    let p = c.join("projects").join(slug(cwd));
    let Some((sid, alive, others)) = session(c, cwd, &p) else {
        return Activity { session: None, alive: false, runs: vec![], agents: vec![], images: vec![], prompts: vec![], panel: None, limits: None, modes: vec![] };
    };
    // Max. 4 Sessions im Cache; nur die am laengsten unbenutzte faellt raus, die anderen muessten sonst alles neu lesen.
    if cache.len() >= 4 && !cache.contains_key(&sid) {
        if let Some(old) = cache.iter().min_by_key(|(_, s)| s.used).map(|(k, _)| k.clone()) {
            cache.remove(&old);
        }
    }
    let st = cache.entry(sid.clone()).or_default();
    st.used = now;
    // Fruehere Sessions desselben Prozesses zuerst, die aktuelle zuletzt: sie gewinnt bei doppelten Agents und Runs.
    let sids: Vec<String> = alive.map_or(vec![], |s| earlier(&p, &sid, s, &others)).into_iter().chain([sid.clone()]).collect();
    let bases: Vec<PathBuf> = sids.iter().map(|s| p.join(s)).collect();
    let scripts: Vec<PathBuf> = bases.iter().rev().map(|b| b.join("workflows/scripts")).collect();

    // Bilder
    for s in &sids {
        scan_images(st, &p.join(format!("{s}.jsonl")));
    }
    let subs: Vec<PathBuf> = bases
        .iter()
        .flat_map(|b| walkdir::WalkDir::new(b.join("subagents")))
        .flatten()
        .map(|e| e.into_path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("agent-") && n.ends_with(".jsonl")))
        .collect();
    for f in &subs {
        scan_images(st, f);
    }

    // Agent-Tool-Agents liegen direkt in subagents/, Workflow-Agents darunter
    let tops: Vec<PathBuf> = bases.iter().map(|b| b.join("subagents")).collect();
    let mut agents: Vec<Agent> = Vec::new();
    for a in subs.iter().filter(|f| f.parent().is_some_and(|d| tops.iter().any(|t| t == d))).filter_map(|f| solo(st, f, alive.is_some())) {
        match agents.iter_mut().find(|x| x.id == a.id) {
            Some(x) => merge(x, a),
            None => agents.push(a),
        }
    }

    // Workflows
    let mut runs: Vec<Run> = Vec::new();
    for base in &bases {
        for e in fs::read_dir(base.join("subagents/workflows")).into_iter().flatten().flatten() {
            let Some(id) = e.file_name().to_str().filter(|n| n.starts_with("wf_")).map(String::from) else { continue };
            let json = base.join("workflows").join(format!("{id}.json"));
            // Fortgesetzt: Journal neuer als das Ergebnis, die alte JSON gilt erst wieder, wenn der Run sie neu schreibt.
            let mtime = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
            let r = if matches!((mtime(&e.path().join("journal.jsonl")), mtime(&json)), (Some(j), Some(w)) if j > w) {
                st.done.remove(&id);
                live(st, &e.path(), &scripts, &id, alive, now)
            } else if let Some(r) = st.done.get(&id) {
                r.clone()
            } else if let Some(v) = fs::read_to_string(&json).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
                let r = finished(&v, &id, &e.path());
                st.done.insert(id, r.clone());
                r
            } else {
                live(st, &e.path(), &scripts, &id, alive, now)
            };
            match runs.iter_mut().find(|x| x.id == r.id) {
                // Uebernommener Run ohne Skript: Name und Phasen aus der frueheren Session
                Some(x) => {
                    let mut r = r;
                    if r.name == r.id {
                        r.name = std::mem::take(&mut x.name);
                    }
                    if r.phases.is_empty() {
                        (r.phases, r.planned) = (std::mem::take(&mut x.phases), std::mem::take(&mut x.planned));
                    }
                    *x = r;
                }
                None => runs.push(r),
            }
        }
    }
    let rank = |s: &str| match s {
        "running" => 0,
        "error" | "failed" => 1,
        "aborted" | "killed" => 2,
        _ => 3,
    };
    runs.sort_by_key(|r| (r.status != "running", std::cmp::Reverse(r.started)));
    runs.truncate(10);
    for r in &mut runs {
        r.agents.sort_by_key(|a| rank(&a.state));
    }
    agents.sort_by_key(|a| (rank(&a.state), std::cmp::Reverse(a.started)));
    agents.truncate(50);
    Activity { session: Some(sid), alive: alive.is_some(), runs, agents, images: st.imgs.iter().map(|x| x.1.clone()).collect(), prompts: st.prompts.clone(), panel: None, limits: None, modes: vec![] }
}

/// Nur das Session-Panel der Mod (Kopfleiste ueber dem Terminal), ohne den Rest von claude_activity.
#[tauri::command]
pub fn claude_panel(id: String) -> Option<Value> {
    crate::pty::valid_id(&id).then(|| fs::read_to_string(panel_file(&id)).ok().and_then(|t| serde_json::from_str(&t).ok())).flatten()
}

/// Slash-Command fuer die Mod: sie pollt <panel>.cmd und fuehrt ihn per $.command.run aus, sobald claude frei ist.
#[tauri::command]
pub fn claude_command(id: String, command: String, args: String) -> Result<u64, String> {
    if !crate::pty::valid_id(&id) {
        return Err(format!("Ungueltige Sitzung: {id}"));
    }
    let f = panel_file(&id).with_extension("cmd");
    fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    let at = now_ms();
    fs::write(f, serde_json::json!({ "at": at, "command": command, "args": args }).to_string()).map_err(|e| e.to_string())?;
    Ok(at)
}

#[tauri::command]
pub async fn claude_activity(cwd: String, id: String) -> Result<Activity, String> {
    blocking(move || {
        let mut a = activity_in(&mut *CACHE.lock().map_err(|e| e.to_string())?, &config_dir(), &real(&cwd), now_ms());
        // Halb geschriebene Datei: None, das Frontend behaelt den letzten Wert.
        a.modes = modes(&config_dir());
        if crate::pty::valid_id(&id) {
            a.panel = fs::read_to_string(panel_file(&id)).ok().and_then(|t| serde_json::from_str(&t).ok());
        }
        a.limits = newest_limits(&std::env::temp_dir().join("open-claude-panel"));
        Ok(a)
    })
    .await
}

fn image_at(r: &ImgRef) -> Result<String, String> {
    let mut f = File::open(&r.path).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(r.offset)).map_err(|e| e.to_string())?;
    let mut line = Vec::new();
    BufReader::new(f.take(64 << 20)).read_until(b'\n', &mut line).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_slice(line.trim_ascii_end()).map_err(|e| e.to_string())?;
    let mut found = Vec::new();
    images(&v, None, &mut found);
    let src = found.get(r.nth).ok_or("Bild nicht gefunden")?.0;
    let mt = str_of(src, "media_type");
    if !IMAGE_TYPES.contains(&mt) {
        return Err(format!("Bildtyp nicht erlaubt: {mt}"));
    }
    Ok(format!("data:{mt};base64,{}", str_of(src, "data")))
}

/// Vorschau (hoechstens 320x180, JPEG) fuer die Kacheln im Panel: wenige KB statt des Vollbilds, das der
/// Browser sonst fuer jede Kachel dekodieren muesste (ruckelt bei hunderten Bildern, belegt GB).
fn thumb_of(data_url: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let b64 = data_url.split_once(',').ok_or("Kein data-URL")?.1;
    let bytes = STANDARD.decode(b64).map_err(|e| e.to_string())?;
    let small = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.thumbnail(320, 180).into_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 75).encode_image(&small).map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(out)))
}

fn img_ref(sid: &str, id: usize) -> Result<ImgRef, String> {
    let cache = CACHE.lock().map_err(|e| e.to_string())?;
    cache.get(sid).and_then(|st| st.imgs.get(id)).map(|x| x.0.clone()).ok_or("Unbekanntes Bild".into())
}

#[tauri::command]
pub async fn claude_image(sid: String, id: usize) -> Result<String, String> {
    blocking(move || image_at(&img_ref(&sid, id)?)).await
}

#[tauri::command]
pub async fn claude_thumb(sid: String, id: usize) -> Result<String, String> {
    blocking(move || thumb_of(&image_at(&img_ref(&sid, id)?)?)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SID: &str = "0000aaaa-1111-2222-3333-444455556666";

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ocui-act-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn append(path: &Path, text: &str) {
        fs::OpenOptions::new().append(true).open(path).unwrap().write_all(text.as_bytes()).unwrap();
    }

    /// Config-Ordner mit Projekt fuer /w/p; alive = sessions-Datei mit startedAt 0.
    fn setup(name: &str, alive: bool) -> (PathBuf, PathBuf) {
        let c = tmp(name);
        if alive {
            put(&c.join("sessions/1.json"), &format!(r#"{{"sessionId":"{SID}","cwd":"/w/p","startedAt":0,"updatedAt":1}}"#));
        }
        let base = c.join("projects/-w-p").join(SID);
        put(&c.join(format!("projects/-w-p/{SID}.jsonl")), "");
        (c, base)
    }

    #[test]
    fn slug_ersetzt() {
        assert_eq!(slug("/Users/x/dev/a.b"), "-Users-x-dev-a-b");
        assert_eq!(iso_ms("1970-01-01T00:00:01.5Z"), 1500);
        assert_eq!(iso_ms("2026-10-08T19:03:10.208Z"), 1791486190208);
    }

    const JOURNAL: &str = concat!(
        r#"{"type":"launched"}"#,
        "\n",
        r#"{"type":"started","key":"k1","agentId":"a1","label":"eins","phase":"Research"}"#,
        "\n",
        r#"{"type":"started","key":"k2","agentId":"a2","label":"zwei","phase":"Research"}"#,
        "\n",
        r#"{"type":"started","key":"k3","agentId":"a3","label":"drei","phase":"Extra"}"#,
        "\n",
        r#"{"type":"result","key":"k1","agentId":"a1","result":"fertig"}"#,
        "\n",
        r#"{"type":"failed","key":"k2","agentId":"a2","error":"kaputt"}"#,
        "\n"
    );

    #[test]
    fn journal_zustaende() {
        for alive in [true, false] {
            let (c, base) = setup(&format!("j{alive}"), alive);
            put(&base.join("subagents/workflows/wf_1/journal.jsonl"), JOURNAL);
            put(&base.join("workflows/scripts/mein-flow-wf_1.js"), "export const meta = {\n  phases: [{ title: 'Research' }],\n}\n");
            let a = activity_in(&mut Cache::new(), &c, "/w/p", now_ms());
            let r = &a.runs[0];
            assert_eq!(r.name, "mein-flow");
            assert_eq!(r.phases, ["Research", "Extra"]);
            let st = |l: &str| r.agents.iter().find(|a| a.label == l).unwrap().state.clone();
            assert_eq!(st("eins"), "done");
            assert_eq!(st("zwei"), "error");
            assert_eq!(r.agents.iter().find(|a| a.label == "zwei").unwrap().result.as_deref(), Some("kaputt"));
            if alive {
                assert_eq!((st("drei").as_str(), r.status.as_str()), ("running", "running"));
                assert_eq!(r.agents[0].label, "drei");
            } else {
                assert_eq!((st("drei").as_str(), r.status.as_str()), ("aborted", "aborted"));
            }
        }
    }

    #[test]
    fn fertige_json_gewinnt() {
        let (c, base) = setup("json", true);
        put(&base.join("subagents/workflows/wf_2/journal.jsonl"), JOURNAL);
        put(
            &base.join("workflows/wf_2.json"),
            r#"{"workflowName":"x","status":"completed","durationMs":5,"totalTokens":575163,"startTime":9,"phases":[{"title":"Research"}],
               "workflowProgress":[{"type":"workflow_phase"},{"type":"workflow_agent","label":"eins","state":"done","tokens":3,"lastToolName":"Bash","lastToolSummary":"ls","agentId":"a1","promptPreview":"kurz"},
                 {"type":"workflow_agent","label":"zwei","agentId":"a2","promptPreview":"nur Vorschau"}]}"#,
        );
        put(&base.join("subagents/workflows/wf_2/agent-a1.jsonl"), "{\"type\":\"user\",\"message\":{\"content\":\"voller Auftrag\"}}\n{kaputt");
        let a = activity_in(&mut Cache::new(), &c, "/w/p", 0);
        let r = &a.runs[0];
        assert_eq!((r.status.as_str(), r.tokens, r.name.as_str()), ("completed", 575163, "x"));
        assert_eq!(r.agents.len(), 2);
        assert_eq!(r.agents[0].steps[0].summary, "ls");
        let p = |i: usize| r.agents[i].prompt.as_deref();
        assert_eq!((p(0), p(1)), (Some("voller Auftrag"), Some("nur Vorschau")));
    }

    #[test]
    fn agent_transkript() {
        let d = tmp("agent");
        let f = d.join("agent-a1.jsonl");
        let line = |content: &str, input: u64| {
            format!(
                r#"{{"type":"assistant","timestamp":"1970-01-01T00:00:0{input}.000Z","message":{{"id":"m1","usage":{{"input_tokens":{input},"cache_read_input_tokens":10,"cache_creation_input_tokens":100}},"content":[{content}]}}}}"#
            ) + "\n"
        };
        put(
            &f,
            &[
                r#"{"type":"user","message":{"content":"\"type\":\"assistant\""}}"#.to_string() + "\n",
                line(r#"{"type":"text","text":"hallo"}"#, 1),
                line(r#"{"type":"tool_use","name":"Bash","input":{"command":"ls -la\nzwei"}}"#, 2),
                line(r#"{"type":"tool_use","name":"Read","input":{"file_path":"/a.png"}}"#, 3),
            ]
            .concat(),
        );
        let s = sum_agent(&mut State::default(), &f);
        assert_eq!(s.tokens, 113);
        assert_eq!(s.tool_calls, 2);
        assert_eq!((s.started, s.last_at), (1000, 3000));
        assert_eq!(s.steps[0].summary, "ls -la");
        assert_eq!(s.steps[1].summary, "/a.png");
        assert_eq!(s.text.as_deref(), Some("hallo"));
        assert_eq!(s.prompt.as_deref(), Some("\"type\":\"assistant\""));
    }

    #[test]
    fn auftrag_ohne_vorspann() {
        let t = "[Workflow harness — computed task] Kein User. The computed task text follows:\n  \n  Projekt: x\n    - eingerueckt\n  \n  Ende\n";
        assert_eq!(task(t), "Projekt: x\n  - eingerueckt\n\nEnde");
        assert_eq!(task("  normaler Prompt\n  zwei\n"), "normaler Prompt\n  zwei");
        let v = serde_json::json!({"type":"user","message":{"content":t}});
        assert_eq!(prompt_of(&v).unwrap(), "Projekt: x\n  - eingerueckt\n\nEnde");
        let anfrage = serde_json::json!({"type":"user","message":{"content":"[Workflow harness — user request] Relay:\n  mach was"}});
        assert_eq!(prompt_of(&anfrage), None);
        let f = tmp("relay").join("agent-a1.jsonl");
        put(&f, &format!("{anfrage}\n{v}\n"));
        assert_eq!(first_prompt(&f).as_deref(), Some("Projekt: x\n  - eingerueckt\n\nEnde"));
        assert_eq!(sum_agent(&mut State::default(), &f).prompt.as_deref(), Some("Projekt: x\n  - eingerueckt\n\nEnde"));
        assert_eq!(agent_log(&f)[0].body, "Projekt: x\n  - eingerueckt\n\nEnde");
    }

    #[test]
    fn plugin_modi() {
        let c = tmp("modi");
        put(&c.join(".ponytail-active"), "ultra\n");
        put(&c.join(".caveman-active"), "");
        put(&c.join(".foo"), "x");
        fs::create_dir_all(c.join(".dir-active")).unwrap();
        let m = |n: &str, l: &str| Mode { name: n.into(), level: l.into() };
        assert_eq!(modes(&c), [m("caveman", ""), m("ponytail", "ultra")]);
    }

    #[test]
    fn agent_zeitleiste() {
        let f = tmp("log").join("agent-a1.jsonl");
        put(
            &f,
            concat!(
                r#"{"type":"user","message":{"content":"Auftrag"}}"#, "\n",
                r#"{"type":"assistant","timestamp":"1970-01-01T00:00:01.000Z","message":{"content":[{"type":"text","text":"los"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#, "\n",
                r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"a\nb\n"}],"is_error":true}]}}"#, "\n",
                r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"/x"}}]}}"#, "\n",
                r#"{"type":"user","message":{"content":"spaeter"}}"#, "\n",
            ),
        );
        let log = agent_log(&f);
        let kinds: Vec<_> = log.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["prompt", "text", "tool", "tool"]);
        assert_eq!((log[0].body.as_str(), log[1].at), ("Auftrag", 1000));
        assert_eq!((log[2].summary.as_str(), log[2].output.as_deref(), log[2].error), ("ls", Some("a\nb"), true));
        assert!(log[2].body.contains("\"command\": \"ls\""));
        // t2 laeuft noch
        assert_eq!(log[3].output, None);
    }

    #[test]
    fn agent_log_kennungen() {
        for (sid, run, agent) in [("../x", "wf_1", "a1"), (SID, "../wf", "a1"), (SID, "wf_1", "a/1"), (SID, "x", "a1")] {
            let r = tauri::async_runtime::block_on(claude_agent_log("/w".into(), sid.into(), run.into(), agent.into()));
            assert!(r.is_err());
        }
    }

    #[test]
    fn phasen_aus_meta() {
        let script = "export const meta = {\n  name: 'x',\n  phases: [\n    { title: 'Research', detail: '3 parallel' },\n    { title: \"Design\", detail: 'b 2' },\n    { title: `Implement` },\n    { title: 'Review' },\n    { title: 'Fix' },\n  ],\n}\n\nphase({ title: 'Nope' })\n";
        let p: Vec<_> = phases_of(script);
        assert_eq!(p.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["Research", "Design", "Implement", "Review", "Fix"]);
        assert_eq!(p.iter().map(|x| x.1).collect::<Vec<_>>(), [3, 0, 0, 0, 0]);
    }

    fn img(data: &str) -> String {
        format!(r#"{{"type":"image","source":{{"type":"base64","media_type":"image/png","data":"{data}"}}}}"#)
    }

    #[test]
    fn bilder_scan() {
        let (c, base) = setup("img", false);
        let main = c.join(format!("projects/-w-p/{SID}.jsonl"));
        put(
            &main,
            &[
                format!(r#"{{"type":"user","timestamp":"1970-01-01T00:00:01Z","imagePasteIds":[2],"message":{{"content":[{{"type":"text","text":"[Image #2]"}},{}]}}}}"#, img("QUJD")),
                // Dublette als queued_command
                format!(r#"{{"type":"attachment","attachment":{{"type":"queued_command","imagePasteIds":[2],"prompt":[{}]}}}}"#, img("QUJD")),
                r#"{"type":"user","message":{"content":[{"type":"text","text":"nur \"type\":\"image\" als Text"}]}}"#.into(),
                r#"{"type":"user","timestamp":"1970-01-01T00:00:02Z","origin":{"kind":"human"},"message":{"content":"  hallo\n"}}"#.into(),
                r#"{"type":"user","origin":{"kind":"task-notification"},"message":{"content":"<task-notification>"}}"#.into(),
                String::new(),
            ]
            .join("\n"),
        );
        let agent = base.join("subagents/agent-a9.jsonl");
        put(
            &agent,
            &(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/x/shot.png"}}]}}"#.to_string()
                + "\n"
                + &format!(r#"{{"type":"user","message":{{"content":[{{"type":"tool_result","tool_use_id":"t1","content":[{}]}}]}}}}"#, img("REVG"))),
        );
        let mut cache = Cache::new();
        let a = activity_in(&mut cache, &c, "/w/p", 0);
        assert_eq!(a.images.len(), 1, "halbe letzte Zeile noch nicht");
        assert_eq!((a.images[0].kind.as_str(), a.images[0].label.as_str(), a.images[0].at), ("paste", "Eingefügt #2", 1000));
        assert_eq!(a.prompts.iter().map(|p| (p.at, p.text.as_str())).collect::<Vec<_>>(), [(2000, "hallo")]);
        append(&agent, "\n");
        let a = activity_in(&mut cache, &c, "/w/p", 0);
        assert_eq!(a.images.len(), 2);
        assert_eq!((a.images[1].kind.as_str(), a.images[1].label.as_str()), ("read", "/x/shot.png"));
        let st = &cache[SID];
        assert_eq!(image_at(&st.imgs[1].0).unwrap(), "data:image/png;base64,REVG");
        assert_eq!(image_at(&st.imgs[0].0).unwrap(), "data:image/png;base64,QUJD");
    }

    #[test]
    fn vorschau_klein_als_jpeg() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let mut png = Vec::new();
        image::RgbImage::from_pixel(1920, 1080, image::Rgb([30, 40, 50]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let t = thumb_of(&format!("data:image/png;base64,{}", STANDARD.encode(&png))).unwrap();
        let jpg = STANDARD.decode(t.strip_prefix("data:image/jpeg;base64,").unwrap()).unwrap();
        let img = image::load_from_memory(&jpg).unwrap();
        assert_eq!((img.width(), img.height()), (320, 180));
        assert!(thumb_of("data:image/png;base64,QUJD").is_err());
    }

    #[test]
    fn agent_tool_agents() {
        let (c, base) = setup("solo", true);
        let main = c.join(format!("projects/-w-p/{SID}.jsonl"));
        let t = |s: u32| format!(r#"{{"type":"assistant","timestamp":"1970-01-01T00:00:0{s}.000Z","message":{{"content":[]}}}}"#) + "\n";
        put(&base.join("subagents/agent-a1.jsonl"), &t(1));
        put(&base.join("subagents/agent-a1.meta.json"), r#"{"agentType":"Explore","description":"Suche"}"#);
        put(&base.join("subagents/agent-a2.jsonl"), &t(1));
        put(&base.join("subagents/workflows/wf_1/agent-a3.jsonl"), &t(1));
        put(
            &main,
            concat!(
                r#"{"type":"user","timestamp":"1970-01-01T00:00:05.000Z","message":{"content":"<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>"}}"#, "\n",
                r#"{"type":"user","timestamp":"1970-01-01T00:00:05.000Z","toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a2"}}"#, "\n",
            ),
        );
        let mut cache = Cache::new();
        let a = activity_in(&mut cache, &c, "/w/p", 0);
        let st: Vec<_> = a.agents.iter().map(|a| (a.id.as_str(), a.state.as_str())).collect();
        assert_eq!(st, [("a2", "running"), ("a1", "done")]);
        assert_eq!((a.agents[1].label.as_str(), a.agents[1].phase.as_str()), ("Suche", "Explore"));
        // fortgesetzt: schreibt nach der Meldung weiter
        append(&base.join("subagents/agent-a1.jsonl"), &t(9));
        let a = activity_in(&mut cache, &c, "/w/p", 0);
        assert!(a.agents.iter().all(|a| a.state == "running"));
    }

    #[test]
    fn nach_clear() {
        let (c, base) = setup("clear", true);
        let proj = c.join("projects/-w-p");
        let (old, other) = (proj.join("0000aaaa-0000-0000-0000-000000000001"), "0000aaaa-0000-0000-0000-000000000002");
        put(&c.join("sessions/2.json"), &format!(r#"{{"sessionId":"{other}","cwd":"/w/p","startedAt":0,"updatedAt":0}}"#));
        let t = r#"{"type":"assistant","timestamp":"1970-01-01T00:00:01.000Z","message":{"content":[]}}"#.to_string() + "\n";
        for f in ["0000aaaa-0000-0000-0000-000000000001.jsonl", &format!("{other}.jsonl")] {
            put(&proj.join(f), "");
        }
        // vor /clear: Agent a1 mit Namen, a5, Workflow mit Skript
        put(&old.join("subagents/agent-a1.jsonl"), &t);
        put(&old.join("subagents/agent-a1.meta.json"), r#"{"agentType":"Explore","description":"Suche"}"#);
        put(&old.join("subagents/agent-a5.jsonl"), &t);
        put(&old.join("subagents/workflows/wf_1/journal.jsonl"), JOURNAL);
        put(&old.join("workflows/scripts/mein-flow-wf_1.js"), "export const meta = {\n  phases: [{ title: 'Research' }],\n}\n");
        // nach /clear: in die neue Session uebernommen, ohne meta und Skript
        put(&base.join("subagents/agent-a1.jsonl"), &(t.clone() + &t));
        put(&base.join("subagents/workflows/wf_1/journal.jsonl"), JOURNAL);
        // andere lebende Session im selben cwd bleibt draussen
        put(&proj.join(other).join("subagents/agent-a7.jsonl"), &t);

        let a = activity_in(&mut Cache::new(), &c, "/w/p", now_ms());
        assert_eq!(a.session.as_deref(), Some(SID));
        let mut ids: Vec<_> = a.agents.iter().map(|a| a.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, ["a1", "a5"]);
        let a1 = a.agents.iter().find(|a| a.id == "a1").unwrap();
        assert_eq!((a1.label.as_str(), a1.phase.as_str()), ("Suche", "Explore"));
        assert_eq!((a.runs.len(), a.runs[0].name.as_str()), (1, "mein-flow"));
        assert_eq!(a.runs[0].phases, ["Research", "Extra"]);
    }

    #[test]
    fn fortgesetzter_run() {
        let (c, base) = setup("resume", true);
        let journal = base.join("subagents/workflows/wf_3/journal.jsonl");
        put(&journal, JOURNAL);
        std::thread::sleep(std::time::Duration::from_millis(20));
        put(&base.join("workflows/wf_3.json"), r#"{"status":"completed","workflowProgress":[]}"#);
        let mut cache = Cache::new();
        assert_eq!(activity_in(&mut cache, &c, "/w/p", now_ms()).runs[0].status, "completed");
        std::thread::sleep(std::time::Duration::from_millis(20));
        append(&journal, "{\"type\":\"started\",\"key\":\"k4\",\"agentId\":\"a4\",\"label\":\"vier\"}\n");
        let r = &activity_in(&mut cache, &c, "/w/p", now_ms()).runs[0];
        assert_eq!(r.status, "running");
        assert!(r.agents.iter().any(|a| a.label == "vier" && a.state == "running"));
    }

    #[test]
    fn neueste_limits() {
        let d = tmp("limits");
        put(&d.join("a.json"), r#"{"limits":[{"kind":"five_hour","percentUsed":5}]}"#);
        std::thread::sleep(std::time::Duration::from_millis(20));
        put(&d.join("b.json"), r#"{"limits":[]}"#);
        put(&d.join("c.json"), "{halb");
        assert_eq!(newest_limits(&d).unwrap()[0]["percentUsed"], 5);
        std::thread::sleep(std::time::Duration::from_millis(20));
        put(&d.join("b.json"), r#"{"limits":[{"kind":"five_hour","percentUsed":9}]}"#);
        assert_eq!(newest_limits(&d).unwrap()[0]["percentUsed"], 9);
    }

    #[test]
    fn neue_zeilen_halbe_bleibt() {
        let d = tmp("lines");
        let f = d.join("t.jsonl");
        put(&f, "a\nbb\nhal");
        let mut offs = HashMap::new();
        let mut got = Vec::new();
        new_lines(&f, &mut offs, |o, l| got.push((o, l.to_string())));
        assert_eq!(got, [(0, "a".to_string()), (2, "bb".to_string())]);
        append(&f, "b\n");
        got.clear();
        new_lines(&f, &mut offs, |o, l| got.push((o, l.to_string())));
        assert_eq!(got, [(5, "halb".to_string())]);
    }

    #[test]
    fn cache_verdraengt_nur_aelteste() {
        let (c, _) = setup("lru", true);
        let mut cache = Cache::new();
        for (i, k) in ["s1", "s2", "s3", "s4"].iter().enumerate() {
            cache.insert(k.to_string(), State { used: [5, 1, 7, 3][i], ..Default::default() });
        }
        assert!(activity_in(&mut cache, &c, "/w/p", 10).alive);
        let mut keys: Vec<_> = cache.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, [SID, "s1", "s3", "s4"]);
    }

    /// Lasttest: ~200 MB Transkript mit grossen Base64-Bildern. Spitzen-Speicher per `/usr/bin/time -l`:
    /// cargo test --release --lib -- --ignored --nocapture transkript_200mb
    #[test]
    #[ignore]
    fn transkript_200mb() {
        let d = tmp("bench200");
        let path = d.join("big.jsonl");
        let mut f = std::io::BufWriter::new(File::create(&path).unwrap());
        let img = "A".repeat(2 << 20);
        for i in 0..100 {
            writeln!(f, r#"{{"type":"user","timestamp":"2026-10-08T19:03:10.208Z","message":{{"content":[{{"type":"image","source":{{"type":"base64","media_type":"image/png","data":"{i}{img}"}}}}]}}}}"#).unwrap();
            for _ in 0..50 {
                writeln!(f, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"{}"}}]}}}}"#, "x".repeat(400)).unwrap();
            }
        }
        drop(f);
        drop(img);
        let mb = fs::metadata(&path).unwrap().len() >> 20;
        let mut st = State::default();
        let t = std::time::Instant::now();
        scan_images(&mut st, &path);
        eprintln!("transkript_200mb: {mb} MB, {} Bilder, {:?}", st.imgs.len(), t.elapsed());
        assert_eq!(st.imgs.len(), 100);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn bild_id_unbekannt() {
        let r = tauri::async_runtime::block_on(claude_image(SID.into(), 999));
        assert!(r.is_err());
    }
}
