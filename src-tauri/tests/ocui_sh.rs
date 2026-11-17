//! Drives the built ocui-sh binary over a stdin pipe (cargo builds it for integration tests).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const EXE: &str = env!("CARGO_BIN_EXE_ocui-sh");

/// Temp dir with `sub/`, removed on drop.
struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn pipe_dir(name: &str) -> Dir {
    let d = std::env::temp_dir().join(format!("ocui-sh-pipe-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join("sub")).unwrap();
    Dir(d)
}

fn pipe(script: &str, dir: &Path) -> (String, i32) {
    let mut child = Command::new(EXE)
        .arg("--no-claude")
        .current_dir(dir)
        .env("OCUI_T", dir.join("sub"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(script.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    (String::from_utf8_lossy(&out.stdout).into_owned(), out.status.code().unwrap_or(-1))
}

/// --only-claude: claude runs with its arguments taken literally, everything else is refused.
#[cfg(unix)]
#[test]
fn nur_claude() {
    use std::os::unix::fs::PermissionsExt;
    let dir = pipe_dir("only");
    let d = &dir.0;
    let fake = d.join("claude");
    std::fs::write(&fake, "#!/bin/sh\necho \"claude[$*]\"\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut child = Command::new(EXE)
        .arg("--only-claude")
        .current_dir(d)
        .env_remove("OPEN_CLAUDE_SETTINGS")
        .env_remove("OCUI_LANG")
        .env("PATH", format!("{}:/usr/bin:/bin", d.display()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let script = "claude --resume 'a b'\ntouch x\nclaude; touch y\nclaude $(touch z) && touch w\ncd sub\nexit\nclaude after-exit\n";
    child.stdin.take().unwrap().write_all(script.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(stdout, "claude[]\nclaude[--resume a b]\nclaude[$(touch z) && touch w]\n", "{stdout}");
    assert_eq!(String::from_utf8_lossy(&out.stderr).matches("nur claude-Befehle").count(), 3);
    for f in ["x", "y", "z", "w"] {
        assert!(!d.join(f).exists(), "{f}");
    }
}

#[test]
fn pipe_builtins_und_exitcodes() {
    let d = pipe_dir("ok");
    let (out, code) = pipe("cd sub\npwd\ncd -\necho hi | tr a-z A-Z\nX=1\necho \"[$X]\"\nfalse\nexit\n", &d.0);
    let lines: Vec<&str> = out.lines().collect();
    assert!(lines[0].ends_with("sub"), "{out}");
    assert_eq!(&lines[2..], ["HI", "[1]"], "{out}");
    assert_eq!(code, 1); // exit ohne Argument: letzter Status
    assert_eq!(pipe("exit 7\necho nie\n", &d.0), (String::new(), 7));
}

#[test]
fn pipe_cd_mit_variable() {
    let d = pipe_dir("cd");
    let (out, _) = pipe("cd $OCUI_T\npwd\ncd ..\ncd su*\npwd\ncd $OCUI_T/fehlt\necho $?\n", &d.0);
    let lines: Vec<&str> = out.lines().collect();
    assert!(lines[0].ends_with("sub") && lines[1].ends_with("sub"), "{out}");
    // The failing cd runs in the system sh: bash exits 1, dash (Ubuntu) 2.
    assert_ne!(lines[2], "0", "{out}");
}

#[test]
fn pipe_zuweisung_mit_quotes_und_variable() {
    let d = pipe_dir("assign");
    let (out, _) = pipe("FOO=\"a b\"\necho \"[$FOO]\"\nexport BAR=$OCUI_T\necho \"[$BAR]\"\n", &d.0);
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines[0], "[a b]", "{out}");
    assert_ne!(lines[1], "[]", "{out}");
}

#[test]
fn pipe_letzter_status_in_dollar_fragezeichen() {
    let d = pipe_dir("status");
    let (out, _) = pipe("false\necho $?\n", &d.0);
    assert_eq!(out.trim(), "1", "{out}");
}
