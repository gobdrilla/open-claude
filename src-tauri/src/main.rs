// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Waechter fuer den Deckel-Schlaf (awake.rs), ohne Fenster.
    #[cfg(target_os = "macos")]
    if std::env::args().nth(1).as_deref() == Some("--lid-guard") {
        return ocui_lib::lid_guard();
    }
    #[cfg(target_os = "macos")]
    if rename_bundle() {
        return;
    }
    // Sonst zeigt WKWebView beim Halten einer Taste das Akzent-Popup statt sie zu wiederholen.
    // Nur fuer unsere App-Domain, vor dem Start von AppKit.
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("defaults")
        .args(["write", "com.marlonschmitz.openclaude", "ApplePressAndHoldEnabled", "-bool", "false"])
        .status();
    // macOS setzt die Bundle-ID als Env; Kindprozesse mit Fenster (Run, Spiele) erben sie
    // und erscheinen dann als weiteres "L'Atelier de Claude" im Dock.
    #[cfg(target_os = "macos")]
    std::env::remove_var("__CFBundleIdentifier");
    ocui_lib::run()
}

/// Updates behalten den Bundle-Ordner aus der Zeit vor 1.4.0: einmal umbenennen, Autostart mitziehen, neu starten.
#[cfg(target_os = "macos")]
fn rename_bundle() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    // .../Open Claude.app/Contents/MacOS/ocui
    let Some(old) = exe.ancestors().nth(3).filter(|p| p.file_name().is_some_and(|n| n == "Open Claude.app")) else {
        return false;
    };
    let new = old.with_file_name("Atelier.app");
    if new.exists() || std::fs::rename(old, &new).is_err() {
        return false;
    }
    // tauri-plugin-autostart benennt den LaunchAgent nach dem App-Namen, darin steht der Bundle-Pfad.
    if let Some(home) = std::env::var_os("HOME") {
        let dir = std::path::Path::new(&home).join("Library/LaunchAgents");
        let plist = dir.join("Open Claude.plist");
        if let Ok(s) = std::fs::read_to_string(&plist) {
            if std::fs::write(dir.join("Atelier.plist"), s.replace("Open Claude", "Atelier")).is_ok() {
                let _ = std::fs::remove_file(plist);
            }
        }
    }
    // Erst nach unserem Ende oeffnen, sonst gibt Single-Instance an diesen Prozess ab.
    std::process::Command::new("/bin/sh").args(["-c", "sleep 1; open \"$0\""]).arg(&new).spawn().is_ok()
}
