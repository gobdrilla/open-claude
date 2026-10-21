//! KI-Vorschlaege im Editor (Grautext wie Copilot/Rider): ein dauerhaft laufendes `claude -p` mit Haiku im
//! stream-json-Modus. Je Vorschlag einen Prozess zu starten kostet ~3,7 s, ein warmer Prozess antwortet in ~1-1,5 s.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const SYSTEM: &str = "Du bist die Code-Vervollständigung eines Editors. Du bekommst eine Datei mit der Markierung <CURSOR>. \
Antworte ausschließlich mit dem Text, der genau an <CURSOR> eingefügt werden soll: kein Markdown, keine Erklärung, \
nichts wiederholen, was vor oder nach dem Cursor schon steht. Meist der Rest der aktuellen Zeile, höchstens ein paar Zeilen. \
Passt nichts Sinnvolles, antworte genau mit <NONE>. Jede Nachricht ist eine neue, unabhängige Aufgabe.";
/// Jede Anfrage bleibt im Verlauf des Prozesses; danach frisch starten, damit Kontext und Latenz nicht wachsen.
const TURNS: u32 = 10;

struct Proc {
    child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
    turns: u32,
}

impl Drop for Proc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct Completer(Mutex<Option<Proc>>);

fn spawn() -> Result<Proc, String> {
    let bin = crate::deps::claude_bin().ok_or("claude nicht gefunden")?;
    let mut cmd = crate::quiet(&bin.to_string_lossy());
    // Ohne Tools, Settings und MCP: kleiner Prompt, schneller Start, und der Vorschlag kann nichts ausfuehren.
    cmd.args(["-p", "--model", "haiku", "--no-session-persistence", "--tools", "", "--setting-sources", ""])
        .args(["--strict-mcp-config", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"])
        .args(["--system-prompt", SYSTEM])
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for key in crate::pty::MARKERS {
        cmd.env_remove(key);
    }
    let mut child = cmd.spawn().map_err(|e| format!("claude konnte nicht gestartet werden: {e}"))?;
    let (Some(stdin), Some(out)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        return Err("claude ohne stdin/stdout".into());
    };
    Ok(Proc { child, stdin, out: BufReader::new(out), turns: 0 })
}

fn ask(p: &mut Proc, prompt: &str) -> Result<String, String> {
    let msg = json!({ "type": "user", "message": { "role": "user", "content": prompt } });
    writeln!(p.stdin, "{msg}").and_then(|_| p.stdin.flush()).map_err(|e| format!("claude: {e}"))?;
    p.turns += 1;
    let mut line = String::new();
    loop {
        line.clear();
        if p.out.read_line(&mut line).map_err(|e| format!("claude: {e}"))? == 0 {
            return Err("claude hat sich beendet".into());
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v["type"] != "result" {
            continue;
        }
        let text = v["result"].as_str().unwrap_or_default().to_string();
        return if v["is_error"] == true { Err(text) } else { Ok(text) };
    }
}

/// Vorschlag fuer die Stelle zwischen `before` und `after`; "" = keiner. Laeuft schon einer, kommt sofort ""
/// (der Editor fragt nach der naechsten Tipp-Pause neu, statt Anfragen zu stapeln).
#[tauri::command]
pub async fn ai_complete(app: AppHandle, path: String, before: String, after: String) -> Result<String, String> {
    crate::git::blocking(move || {
        let state = app.state::<Completer>();
        let Ok(mut slot) = state.0.try_lock() else { return Ok(String::new()) };
        if slot.is_none() {
            *slot = Some(spawn()?);
        }
        let p = slot.as_mut().ok_or("claude nicht gestartet")?;
        let res = ask(p, &format!("Datei: {path}\n\n{before}<CURSOR>{after}"));
        // Kaputt oder verbraucht: gleich den naechsten starten, dann ist er bis zur naechsten Pause warm.
        if res.is_err() || p.turns >= TURNS {
            *slot = spawn().ok();
        }
        res
    })
    .await
}
