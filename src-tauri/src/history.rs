//! Sessions of a project like claude's /resume: title, last prompt and branch from the end of each transcript.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::Serialize;
use serde_json::Value;

use crate::activity::{config_dir, ms, real, slug, str_of, trunc};
use crate::git::blocking;

/// claude appends titles and the last prompt again and again; measured on real transcripts (up to 350 MB) the last
/// ai-title was at most ~34 KB before the end.
const TAIL: u64 = 128 * 1024;
/// Like /resume: the newest ones only.
const MAX: usize = 50;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Past {
    pub sid: String,
    /// /rename before claude's automatic title; empty until there is one.
    pub title: String,
    pub prompt: String,
    pub branch: String,
    /// Last write (ms).
    pub at: u64,
    /// A claude process runs this session right now (sessions/*.json).
    pub live: bool,
}

#[derive(Clone, Default, Debug, PartialEq)]
struct Tail {
    title: String,
    prompt: String,
    branch: String,
}

/// Per transcript: (mtime, size) and what its end said; read again only when the file changed.
type Cache = HashMap<PathBuf, ((u64, u64), Tail)>;
static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(Default::default);

fn tail(path: &Path, len: u64) -> Tail {
    let mut out = Tail::default();
    let Ok(mut f) = File::open(path) else { return out };
    let start = len.saturating_sub(TAIL);
    let mut buf = Vec::new();
    if f.seek(SeekFrom::Start(start)).is_err() || f.take(TAIL).read_to_end(&mut buf).is_err() {
        return out;
    }
    let text = String::from_utf8_lossy(&buf);
    // Started mid-file: the first line is cut off.
    let lines = text.lines().skip(usize::from(start > 0));
    let (mut custom, mut ai) = (None, None);
    for line in lines.collect::<Vec<_>>().into_iter().rev() {
        if custom.is_some() && !out.prompt.is_empty() && !out.branch.is_empty() {
            break;
        }
        // Only parse lines that can hold something wanted; tool output lines are large.
        let kind = ["\"custom-title\"", "\"ai-title\"", "\"last-prompt\"", "\"gitBranch\""].iter().any(|k| line.contains(k));
        let Some(v) = kind.then(|| serde_json::from_str::<Value>(line).ok()).flatten() else { continue };
        match str_of(&v, "type") {
            "custom-title" if custom.is_none() => custom = Some(str_of(&v, "customTitle").to_string()),
            "ai-title" if ai.is_none() => ai = Some(str_of(&v, "aiTitle").to_string()),
            "last-prompt" if out.prompt.is_empty() => out.prompt = trunc(str_of(&v, "lastPrompt").trim(), 200),
            _ => {}
        }
        if out.branch.is_empty() {
            out.branch = str_of(&v, "gitBranch").to_string();
        }
    }
    out.title = custom.filter(|t| !t.trim().is_empty()).or(ai).unwrap_or_default().trim().to_string();
    out
}

fn same_cwd(a: &str, b: &str) -> bool {
    // Windows: spelling can differ from the realpath (c:\dev vs C:\Dev)
    if cfg!(windows) { a.eq_ignore_ascii_case(b) } else { a == b }
}

fn list(c: &Path, cwd: &str) -> Vec<Past> {
    // Running claude processes in this folder. Their "name" is not used: it belongs to the process and survives
    // /resume into another session; /rename also writes custom-title into the transcript right away.
    let live: HashSet<String> = fs::read_dir(c.join("sessions"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_str::<Value>(&fs::read_to_string(e.path()).ok()?).ok())
        .filter(|v| same_cwd(str_of(v, "cwd"), cwd))
        .map(|v| str_of(&v, "sessionId").to_string())
        .collect();
    let mut files: Vec<(u64, u64, PathBuf, String)> = fs::read_dir(c.join("projects").join(slug(cwd)))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let sid = e.file_name().to_str()?.strip_suffix(".jsonl")?.to_string();
            let m = e.metadata().ok()?;
            let ok = !sid.is_empty() && sid.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') && m.is_file();
            let at = ms(m.modified().ok()?);
            ok.then(|| (at, m.len(), e.path(), sid))
        })
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files.truncate(MAX);

    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    // Keeps several projects warm without growing forever.
    if cache.len() > 8 * MAX {
        cache.clear();
    }
    files
        .into_iter()
        .filter_map(|(at, len, path, sid)| {
            let t = match cache.get(&path) {
                Some((k, t)) if *k == (at, len) => t.clone(),
                _ => {
                    let t = tail(&path, len);
                    cache.insert(path, ((at, len), t.clone()));
                    t
                }
            };
            let live = live.contains(&sid);
            // Empty transcripts (started, nothing asked) hide like in /resume.
            (live || !t.title.is_empty() || !t.prompt.is_empty())
                .then_some(Past { live, sid, title: t.title, prompt: t.prompt, branch: t.branch, at })
        })
        .collect()
}

#[tauri::command]
pub async fn claude_sessions(cwd: String) -> Result<Vec<Past>, String> {
    blocking(move || Ok(list(&config_dir(), &real(&cwd)))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ocui-hist-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("projects/-w-p")).unwrap();
        fs::create_dir_all(d.join("sessions")).unwrap();
        d
    }

    #[test]
    fn titel_prompt_branch_und_live() {
        let c = tmp("list");
        let p = c.join("projects/-w-p");
        fs::write(
            p.join("aa.jsonl"),
            concat!(
                r#"{"type":"user","gitBranch":"main","message":{"content":"x"}}"#, "\n",
                r#"{"type":"ai-title","aiTitle":"Alt"}"#, "\n",
                r#"{"type":"custom-title","customTitle":"Von Hand"}"#, "\n",
                r#"{"type":"ai-title","aiTitle":"Neu"}"#, "\n",
                r#"{"type":"last-prompt","lastPrompt":"  mach mal  "}"#, "\n",
            ),
        )
        .unwrap();
        fs::write(p.join("bb.jsonl"), concat!(r#"{"type":"ai-title","aiTitle":"Nur KI"}"#, "\n")).unwrap();
        // Nothing asked yet: hidden, unless it runs.
        fs::write(p.join("cc.jsonl"), concat!(r#"{"type":"file-history-snapshot"}"#, "\n")).unwrap();
        fs::write(p.join("dd.jsonl"), concat!(r#"{"type":"custom-title","customTitle":"Umbenannt"}"#, "\n")).unwrap();
        fs::write(p.join("../evil.jsonl"), "").unwrap();
        // The process name survives /resume into another session: never taken as the title.
        fs::write(c.join("sessions/1.json"), r#"{"sessionId":"dd","cwd":"/w/p","name":"Alter Name","nameSource":"user"}"#).unwrap();
        fs::write(c.join("sessions/2.json"), r#"{"sessionId":"bb","cwd":"/w/p","name":"p-f6","nameSource":"derived"}"#).unwrap();
        fs::write(c.join("sessions/3.json"), r#"{"sessionId":"aa","cwd":"/anders","name":"X","nameSource":"user"}"#).unwrap();

        let mut l = list(&c, "/w/p");
        l.sort_by(|a, b| a.sid.cmp(&b.sid));
        let got: Vec<_> = l.iter().map(|x| (x.sid.as_str(), x.title.as_str(), x.prompt.as_str(), x.branch.as_str(), x.live)).collect();
        assert_eq!(
            got,
            [("aa", "Von Hand", "mach mal", "main", false), ("bb", "Nur KI", "", "", true), ("dd", "Umbenannt", "", "", true)]
        );
    }

    #[test]
    fn nur_das_ende_wird_gelesen() {
        let c = tmp("tail");
        let f = c.join("projects/-w-p/aa.jsonl");
        // Title far before the end is out of reach, a cut first line must not break parsing.
        let big = format!(r#"{{"type":"assistant","x":"{}"}}"#, "y".repeat(TAIL as usize));
        let text = format!("{}\n{big}\n{}\n", r#"{"type":"ai-title","aiTitle":"Weg"}"#, r#"{"type":"ai-title","aiTitle":"Da"}"#);
        fs::write(&f, &text).unwrap();
        assert_eq!(tail(&f, text.len() as u64).title, "Da");
        let text = format!("{}\n{big}\n{}\n", r#"{"type":"ai-title","aiTitle":"Weg"}"#, r#"{"type":"last-prompt","lastPrompt":"p"}"#);
        fs::write(&f, &text).unwrap();
        assert_eq!(tail(&f, text.len() as u64), Tail { title: String::new(), prompt: "p".into(), branch: String::new() });
    }
}
