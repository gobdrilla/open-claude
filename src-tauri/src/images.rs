//! /clean-images: eingefuegte Bilder stehen als base64 in den Transkripten (~/.claude/projects/**/*.jsonl)
//! und blaehen sie auf, bis claude die Datei nach cleanupPeriodDays loescht. Hier werden sie durch einen
//! Text-Platzhalter ersetzt; der Rest bleibt, /resume laeuft weiter (nur ohne die Bilder).

use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const PLACEHOLDER: &str = "[Bild entfernt]";

#[derive(Default, Debug, PartialEq)]
pub(crate) struct Cleaned {
    pub files: usize,
    pub images: usize,
    pub bytes: u64,
    pub skipped: usize,
}

/// Sitzungen mit Datei unter sessions/ gelten als laufend; claude raeumt die Datei beim Beenden weg.
// shortcut: keine PID-Pruefung, nach einem Absturz bleibt die Sitzung uebersprungen, bis claude die Datei ersetzt.
fn live(config: &Path) -> HashSet<String> {
    fs::read_dir(config.join("sessions"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_str::<Value>(&fs::read_to_string(e.path()).ok()?).ok())
        .filter_map(|v| v["sessionId"].as_str().map(String::from))
        .collect()
}

/// Zu welcher Sitzung eine Datei gehoert: <sid>.jsonl oder etwas unter <sid>/ (Subagents).
fn session_of(projects: &Path, file: &Path) -> Option<String> {
    let rel = file.strip_prefix(projects).ok()?;
    let mut parts = rel.components().skip(1).map(|c| c.as_os_str().to_string_lossy().into_owned());
    let first = parts.next()?;
    Some(first.strip_suffix(".jsonl").map(String::from).unwrap_or(first))
}

fn jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        match e.file_type() {
            Ok(t) if t.is_dir() => jsonl(&p, out),
            Ok(t) if t.is_file() && p.extension().is_some_and(|x| x == "jsonl") => out.push(p),
            _ => {}
        }
    }
}

/// Bild-Bloecke (auch in tool_result) rekursiv durch Text ersetzen; zaehlt die ersetzten.
fn strip(v: &mut Value) -> usize {
    match v {
        Value::Object(o) if o.get("type").and_then(Value::as_str) == Some("image") && o.contains_key("source") => {
            *v = json!({ "type": "text", "text": PLACEHOLDER });
            1
        }
        Value::Object(o) => o.values_mut().map(strip).sum(),
        Value::Array(a) => a.iter_mut().map(strip).sum(),
        _ => 0,
    }
}

/// Zeilen ohne Bild bleiben Byte fuer Byte gleich, auch unparsbare.
fn clean_text(text: &str) -> (String, usize) {
    let mut n = 0;
    let out = text
        .split_inclusive('\n')
        .map(|line| {
            if !line.contains("\"type\":\"image\"") {
                return line.to_string();
            }
            let Ok(mut v) = serde_json::from_str::<Value>(line) else { return line.to_string() };
            let k = strip(&mut v);
            if k == 0 {
                return line.to_string();
            }
            n += k;
            let nl = if line.ends_with('\n') { "\n" } else { "" };
            format!("{v}{nl}")
        })
        .collect();
    (out, n)
}

fn clean_file(p: &Path) -> std::io::Result<(usize, u64)> {
    let text = fs::read_to_string(p)?;
    let read = text.len() as u64;
    let (mut out, n) = clean_text(&text);
    if n == 0 {
        return Ok((0, 0));
    }
    // Laufende Sitzung (nur mit "hier"): was claude seit dem Lesen angehaengt hat, mitnehmen.
    let mut f = fs::File::open(p)?;
    f.seek(SeekFrom::Start(read))?;
    let mut raw = String::new();
    f.read_to_string(&mut raw)?;
    let (tail, m) = clean_text(&raw);
    out.push_str(&tail);
    let tmp = p.with_extension("jsonl.clean");
    fs::write(&tmp, &out)?;
    // Transkripte sind 0600, die neue Datei bekaeme sonst Standardrechte.
    fs::set_permissions(&tmp, fs::metadata(p)?.permissions())?;
    fs::rename(&tmp, p)?;
    Ok((n + m, (read + raw.len() as u64).saturating_sub(out.len() as u64)))
}

/// `older_days`: nur Transkripte, die so lange unveraendert sind (None = alle). `here`: diese laufende Sitzung
/// trotzdem bereinigen (die eigene, von /clean-images hier).
pub(crate) fn clean(config: &Path, older_days: Option<u64>, here: Option<&str>) -> Cleaned {
    let projects = config.join("projects");
    let live = live(config);
    let cutoff = older_days.map(|d| SystemTime::now() - Duration::from_secs(d * 86_400));
    let mut files = Vec::new();
    jsonl(&projects, &mut files);
    let mut r = Cleaned::default();
    for p in files {
        let sid = session_of(&projects, &p).unwrap_or_default();
        if live.contains(&sid) && here != Some(sid.as_str()) {
            r.skipped += 1;
            continue;
        }
        let modified = fs::metadata(&p).and_then(|m| m.modified()).ok();
        if cutoff.is_some_and(|c| modified.is_none_or(|m| m > c)) {
            continue;
        }
        if let Ok((n, saved)) = clean_file(&p) {
            if n > 0 {
                r.files += 1;
                r.images += n;
                r.bytes += saved;
            }
        }
    }
    r
}

/// Argumente von /clean-images: alle | 1d | 7d, dazu optional "hier".
pub(crate) fn parse(args: &str) -> Result<(Option<u64>, bool), String> {
    let mut days = None;
    let mut here = false;
    for w in args.split_whitespace() {
        match w {
            "alle" | "all" => days = None,
            "hier" | "here" => here = true,
            _ => days = Some(w.strip_suffix('d').and_then(|d| d.parse().ok()).ok_or(format!("Unbekannt: {w} (alle, 1d, 7d, hier)"))?),
        }
    }
    Ok((days, here))
}

pub(crate) fn summary(r: &Cleaned) -> String {
    let mb = r.bytes as f64 / 1_048_576.0;
    let skipped = if r.skipped > 0 { format!(", {} Datei(en) laufender Sitzungen übersprungen", r.skipped) } else { String::new() };
    format!("{} Bild(er) aus {} Transkript(en) entfernt, {mb:.1} MB frei{skipped}.", r.images, r.files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ersetzt_bilder_und_laesst_rest() {
        let img = r#"{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}}"#;
        let text = format!(
            "{{\"message\":{{\"content\":[{img},{{\"type\":\"text\",\"text\":\"hi\"}}]}}}}\nkaputt \"type\":\"image\"\n{{\"x\":1}}"
        );
        let (out, n) = clean_text(&text);
        assert_eq!(n, 1);
        assert!(!out.contains("AAAA") && out.contains(PLACEHOLDER) && out.contains("\"hi\""));
        assert!(out.ends_with("kaputt \"type\":\"image\"\n{\"x\":1}"));
    }

    #[test]
    fn ueberspringt_laufende_und_neue() {
        let c = std::env::temp_dir().join(format!("ocui-img-{}", std::process::id()));
        let _ = fs::remove_dir_all(&c);
        let p = c.join("projects/-w-p");
        fs::create_dir_all(p.join("live/subagents")).unwrap();
        fs::create_dir_all(c.join("sessions")).unwrap();
        fs::write(c.join("sessions/1.json"), r#"{"sessionId":"live"}"#).unwrap();
        let line = r#"{"content":[{"type":"image","source":{"data":"QUJD"}}]}"#.to_string() + "\n";
        for f in ["alt.jsonl", "live.jsonl", "live/subagents/a.jsonl"] {
            fs::write(p.join(f), &line).unwrap();
        }
        // Frisch geschrieben: mit 1d nichts
        assert_eq!(clean(&c, Some(1), None).files, 0);
        let r = clean(&c, None, None);
        assert_eq!((r.files, r.images, r.skipped), (1, 1, 2));
        assert!(fs::read_to_string(p.join("live.jsonl")).unwrap().contains("QUJD"));
        // "hier" nimmt die eigene laufende Sitzung samt Subagents mit
        assert_eq!(clean(&c, None, Some("live")).files, 2);
        assert!(!fs::read_to_string(p.join("live/subagents/a.jsonl")).unwrap().contains("QUJD"));
        let _ = fs::remove_dir_all(&c);
    }

    #[test]
    fn argumente() {
        assert_eq!(parse(""), Ok((None, false)));
        assert_eq!(parse("7d hier"), Ok((Some(7), true)));
        assert_eq!(parse("1d"), Ok((Some(1), false)));
        assert!(parse("x").is_err());
    }
}
