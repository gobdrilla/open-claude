//! Terminal in der App: je Session ein PTY (ConPTY unter Windows), Output roh als Event ans Frontend.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

struct Session {
    // Unterscheidet eine neue Session mit gleicher id von der alten, deren Waiter noch auslaeuft.
    gen: u64,
    // Eingaben gehen an einen eigenen Writer-Thread: liest das Kind nicht, blockiert sonst write_all
    // samt Map-Lock und Main-Thread die ganze App. Der Channel haelt die Reihenfolge der Tasten.
    input: Sender<Vec<u8>>,
    master: Box<dyn MasterPty + Send>,
    // Das Child selbst gehoert dem Waiter-Thread (wait() blockiert).
    killer: Box<dyn ChildKiller + Send + Sync>,
    // Nur Run-Leiste: pid der Shell, um beim Stoppen den ganzen Prozessbaum zu treffen (npm -> node).
    tree: Option<u32>,
}

impl Session {
    fn kill(&mut self) {
        // Vor dem Kill des Elternprozesses, sonst findet taskkill die Kinder nicht mehr.
        #[cfg(windows)]
        if let Some(pid) = self.tree {
            let _ = crate::quiet("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).status();
        }
        // Gruppe der Shell (nach setsid ist pid auch die Gruppe) und die im Vordergrund des PTY: eine interaktive
        // Shell gibt dem Kommando eine eigene. Erst SIGHUP, und wer das ignoriert, bekommt nach 1 s SIGKILL.
        // ponytail: `kill` als Prozess statt libc::kill, spart die direkte Abhaengigkeit; blockiert hoechstens 1 s.
        #[cfg(unix)]
        if let Some(pid) = self.tree {
            let mut groups = vec![pid as i32];
            groups.extend(self.master.process_group_leader());
            groups.retain(|g| *g > 1);
            groups.dedup();
            let signal = |sig: &str| {
                let sent = |g: &i32| {
                    std::process::Command::new("kill")
                        .args([sig, "--", &format!("-{g}")])
                        .stderr(std::process::Stdio::null())
                        .status()
                        .is_ok_and(|s| s.success())
                };
                groups.iter().filter(|g| sent(g)).count()
            };
            signal("-HUP");
            for _ in 0..10 {
                if signal("-0") == 0 {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            signal("-KILL");
        }
        let _ = self.killer.kill();
    }
}

// ponytail: ein Lock fuer alle Sessions, pro-Session-Locks falls viele Terminals parallel schreiben.
#[derive(Default)]
pub struct Ptys(Mutex<HashMap<String, Session>>);

static NEXT_GEN: AtomicU64 = AtomicU64::new(0);

impl Ptys {
    // Threads duerfen nicht paniken (panic = "abort"), also Poisoning schlucken.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Beim Beenden: sonst ueberleben Shell und claude die App.
    pub fn close_all(&self) {
        let sessions: Vec<Session> = self.lock().drain().map(|(_, s)| s).collect();
        for mut s in sessions {
            s.kill();
            // Drop schliesst die Pseudo-Konsole und reisst angehaengte Prozesse mit.
        }
    }
}

/// id landet im Eventnamen, darum nur ein sicherer Zeichensatz.
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Pfade als Strings, damit die Windows-Logik auch auf macOS testbar bleibt.
fn join(dir: &str, file: &str) -> String {
    format!("{}\\{}", dir.trim_end_matches(['\\', '/']), file)
}

fn parent(dir: &str) -> Option<&str> {
    dir.trim_end_matches(['\\', '/'])
        .rsplit_once(['\\', '/'])
        .map(|(p, _)| p)
}

/// Fallback ohne $SHELL: Standard-Shell des Systems.
pub(crate) const UNIX_SHELL: &str = if cfg!(target_os = "macos") { "/bin/zsh" } else { "/bin/bash" };

/// Welche Shell `claude` startet. Unix: $SHELL als Login-Shell. Windows: zuerst die eigene
/// ocui-sh (`own`, liegt neben der App), sonst Git-Bash, pwsh, cmd.
/// `settings`: claude bekommt `--settings` aus $OPEN_CLAUDE_SETTINGS (Shell expandiert, kein Quoting).
fn shell(
    windows: bool,
    own: &str,
    settings: bool,
    env: impl Fn(&str) -> Option<String>,
    exists: impl Fn(&str) -> bool,
) -> (String, Vec<String>) {
    let claude = if settings { "claude --settings \"$OPEN_CLAUDE_SETTINGS\"" } else { "claude" };
    if !windows {
        let sh = env("SHELL")
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| UNIX_SHELL.into());
        // Login-Shell fuer PATH; nach claude bleibt dieselbe Shell offen (auch zsh/fish).
        let rest = format!("{claude}; exec {sh} -li");
        return (sh, vec!["-lic".into(), rest]);
    }
    // ocui-sh (fuer Git-Bash gebaut) startet claude selbst, danach ihre REPL.
    if exists(own) {
        return (own.into(), vec![]);
    }

    let path = env("PATH").unwrap_or_default();
    let on_path = |exe: &str| {
        path.split(';')
            .filter(|d| !d.trim().is_empty())
            .map(|d| join(d, exe))
            .find(|p| exists(p))
    };

    let mut bash = Vec::new();
    if let Some(pf) = env("ProgramFiles") {
        bash.push(join(&pf, "Git\\bin\\bash.exe"));
    }
    if let Some(la) = env("LOCALAPPDATA") {
        bash.push(join(&la, "Programs\\Git\\bin\\bash.exe"));
    }
    // <Git>\cmd\git.exe oder <Git>\mingw64\bin\git.exe -> <Git>\bin\bash.exe
    if let Some(git) = on_path("git.exe") {
        let dir = parent(&git);
        let up1 = dir.and_then(parent);
        let up2 = up1.and_then(parent);
        bash.extend([up1, up2].into_iter().flatten().map(|g| join(g, "bin\\bash.exe")));
    }
    if let Some(b) = bash.into_iter().find(|b| exists(b)) {
        return (b, vec!["-lic".into(), format!("{claude}; exec bash -li")]);
    }

    if let Some(pwsh) = on_path("pwsh.exe") {
        let claude = if settings { "claude --settings $env:OPEN_CLAUDE_SETTINGS" } else { "claude" };
        return (pwsh, vec!["-NoExit".into(), "-Command".into(), claude.into()]);
    }
    // ponytail: cmd ohne --settings (Pfad mit Leerzeichen nicht sauber quotebar), Theme bleibt dann wie gewaehlt.
    ("cmd.exe".into(), vec!["/k".into(), "claude".into()])
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_open(
    app: AppHandle,
    ptys: State<'_, Ptys>,
    ides: State<'_, crate::ide::Ides>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    theme: String,
    dirs: Option<Vec<String>>,
    out: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    // Repo-Gruppe: weitere Repos, die claude neben cwd kennt und bearbeiten darf. Nur vorhandene Ordner.
    let extra: Vec<String> = dirs
        .unwrap_or_default()
        .into_iter()
        .filter(|d| Path::new(d).is_dir() && d != &cwd)
        .collect();
    // ocui-sh liegt neben der Exe: dev target/debug, installiert packt tauri build alle Bins
    // des Pakets mit ein. Fehlt es, greift die Fallback-Shell.
    let own = std::env::current_exe()
        .map(|e| e.with_file_name(format!("ocui-sh{}", std::env::consts::EXE_SUFFIX)))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let settings = session_settings(&app, &theme, &extra).map(|p| p.to_string_lossy().into_owned());
    let (program, args) =
        shell(cfg!(windows), &own, settings.is_some(), |k| std::env::var(k).ok(), |p| Path::new(p).is_file());
    let dirs = mod_dirs(&app);
    // Ordner vorher sicher anlegen; geht das nicht (fremder Besitzer), laeuft die Sitzung ohne Panel.
    let panel = crate::activity::ensure_panel_dir()
        .map_err(|e| eprintln!("Panel-Ordner: {e}"))
        .ok()
        .map(|_| crate::activity::panel_file(&id).to_string_lossy().into_owned());
    let mut env: Vec<_> = dirs.iter().map(|d| ("CLAUDE_CODE_PLUGIN_DIRS", d.as_str())).collect();
    // Die Mod schreibt ihre Session-Daten dorthin, das App-Panel liest sie.
    if let Some(p) = &panel {
        env.push(("OPEN_CLAUDE_PANEL", p));
    }
    if let Some(s) = &settings {
        env.push(("OPEN_CLAUDE_SETTINGS", s));
    }
    // CLAUDE.md der weiteren Repos mitladen, damit claude deren Regeln und Aufbau kennt.
    if !extra.is_empty() {
        env.push(("CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD", "1"));
    }
    // IDE-Anbindung und MCP-Server; ohne laeuft claude trotzdem.
    let ide = crate::ide::start(&app, &ides, &id, &cwd).unwrap_or_default();
    env.extend(ide.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    // claude geht auch zu 127.0.0.1 ueber HTTP(S)_PROXY, wenn no_proxy es nicht ausnimmt.
    let no_proxy = no_proxy(std::env::var("NO_PROXY").or_else(|_| std::env::var("no_proxy")).ok());
    if !ide.is_empty() {
        env.push(("NO_PROXY", &no_proxy));
        env.push(("no_proxy", &no_proxy));
    }
    // Fullscreen-Layout: nur dort dockt das /panel-Pane.
    env.push(("CLAUDE_CODE_NO_FLICKER", "1"));
    // ConPTY laesst im Alt-Screen sonst Zeichenreste stehen.
    if cfg!(windows) {
        env.push(("CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT", "1"));
    }
    spawn(app, &ptys, id, &cwd, &program, args, cols, rows, &env, false, out)
}

fn no_proxy(prev: Option<String>) -> String {
    match prev.filter(|p| !p.trim().is_empty()) {
        Some(p) => format!("{p},127.0.0.1,localhost"),
        None => "127.0.0.1,localhost".into(),
    }
}

/// subagentStatusLine: je Agent-Task eine Zeile mit leerem content; claude blendet solche Zeilen unter dem
/// Prompt aus (die Agents zeigt das Panel). Bekommt die Tasks als kompaktes JSON auf stdin; ueberzaehlige
/// ids (z. B. die der Session) ignoriert claude. Unter Windows laeuft es in der Git-Bash von Claude Code.
const HIDE_AGENTS: &str = r#"grep -o '"id":"[^"]*"' | sed 's/^/{/; s/$/,"content":""}/'"#;

/// Settings-Datei fuer diese Session per `--settings`: Agent-Zeilen aus (HIDE_AGENTS) und, hat der User ein
/// Open-Claude-Theme gewaehlt, das nicht zum App-Modus passt, das passende (/config nimmt keine Custom-Themes).
/// `dirs` (Repo-Gruppe) werden zusaetzliche Arbeitsordner wie bei --add-dir; claude nennt sie im Systemprompt.
fn session_settings(app: &AppHandle, mode: &str, dirs: &[String]) -> Option<PathBuf> {
    let user = std::fs::read_to_string(crate::activity::config_dir().join("settings.json")).ok();
    let user: Option<serde_json::Value> = user.and_then(|u| serde_json::from_str(&u).ok());
    let text = settings_json(mode, user.as_ref(), dirs);
    // Je Gruppe eine eigene Datei, sonst teilen sich alle Sitzungen eines Modus eine.
    let name = if dirs.is_empty() {
        format!("session-{mode}.json")
    } else {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        dirs.hash(&mut h);
        format!("session-{mode}-{:016x}.json", h.finish())
    };
    let p = app.path().app_data_dir().ok()?.join(name);
    if std::fs::read_to_string(&p).ok().as_deref() != Some(&text) {
        std::fs::create_dir_all(p.parent()?).ok()?;
        std::fs::write(&p, text).ok()?;
    }
    Some(p)
}

fn settings_json(mode: &str, user: Option<&serde_json::Value>, dirs: &[String]) -> String {
    let mut settings = serde_json::json!({ "subagentStatusLine": { "type": "command", "command": HIDE_AGENTS } });
    if let Some(want) = user.and_then(|u| u.get("theme")?.as_str()).and_then(|t| theme_for(t, mode)) {
        settings["theme"] = want.into();
    }
    if !dirs.is_empty() {
        settings["permissions"] = serde_json::json!({ "additionalDirectories": dirs });
    }
    settings.to_string()
}

/// Nur zwischen den eigenen Themes wechseln; wer etwas anderes gewaehlt hat (auch auto), bleibt dabei.
fn theme_for(cur: &str, mode: &str) -> Option<&'static str> {
    let want = match mode {
        "light" => "custom:open-claude:open-claude-light",
        "dark" => "custom:open-claude:open-claude",
        _ => return None,
    };
    (cur.starts_with("custom:open-claude:open-claude") && cur != want).then_some(want)
}

/// Dateien der eingebauten Mod fuer Release (Test mod_files_vollstaendig prueft, dass keine fehlt).
const FILES: &[(&str, &str)] = &[
    (".claude-plugin/plugin.json", include_str!("../mods/open-claude/.claude-plugin/plugin.json")),
    ("hooks/hooks.json", include_str!("../mods/open-claude/hooks/hooks.json")),
    ("skills/smart-tests/SKILL.md", include_str!("../mods/open-claude/skills/smart-tests/SKILL.md")),
    ("skills/workflow-templates/SKILL.md", include_str!("../mods/open-claude/skills/workflow-templates/SKILL.md")),
    ("skills/forge-pr/SKILL.md", include_str!("../mods/open-claude/skills/forge-pr/SKILL.md")),
    ("hooks/register.tsx", include_str!("../mods/open-claude/hooks/register.tsx")),
    ("types/index.d.ts", include_str!("../mods/open-claude/types/index.d.ts")),
    ("themes/open-claude.json", include_str!("../mods/open-claude/themes/open-claude.json")),
    ("themes/open-claude-light.json", include_str!("../mods/open-claude/themes/open-claude-light.json")),
];

/// Eingebaute Mod. Debug: Quellordner direkt (Hot-Reload). Release: eingebettet und nach
/// app_data_dir geschrieben, weil claude in jeden Mod-Ordner .claude-plugin/types/ schreibt
/// und das signierte .app-Bundle dabei kaputt ginge.
pub(crate) fn builtin_mod(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("mods/open-claude"));
    }
    let dir = app.path().app_data_dir().ok()?.join("mods/open-claude");
    for (rel, text) in FILES {
        let p = dir.join(rel);
        // Nur bei Aenderung schreiben, sonst laedt claude die Mod bei jedem Terminal neu.
        if std::fs::read_to_string(&p).ok().as_deref() != Some(text) {
            std::fs::create_dir_all(p.parent()?).ok()?;
            std::fs::write(&p, text).ok()?;
        }
    }
    Some(dir)
}

/// CLAUDE_CODE_PLUGIN_DIRS fuer claude: eingebaute und installierte Mods.
pub(crate) fn mod_dirs(app: &AppHandle) -> Option<String> {
    let mods = crate::skills::mods(&crate::skills::mods_dir()).into_iter().map(|m| m.path.into());
    plugin_dirs(std::env::var("CLAUDE_CODE_PLUGIN_DIRS").ok(), builtin_mod(app).into_iter().chain(mods))
}

/// Mod-Ordner hinter einen schon gesetzten Wert haengen; ohne Mods None (Env bleibt wie geerbt).
/// Geerbte Ordner mit dem Namen einer eigenen Mod fallen weg: aus einer Open-Claude-Sitzung gestartet
/// (z. B. tauri dev) stuende die Mod sonst doppelt drin, samt doppelter Themes und Skills.
fn plugin_dirs(prev: Option<String>, mods: impl Iterator<Item = std::path::PathBuf>) -> Option<String> {
    let mods: Vec<_> = mods.collect();
    if mods.is_empty() {
        return None;
    }
    let prev = prev.unwrap_or_default();
    let own = |p: &Path| mods.iter().any(|m| m.file_name() == p.file_name());
    let all = std::env::split_paths(&prev).filter(|p| !p.as_os_str().is_empty() && !own(p)).chain(mods.iter().cloned());
    std::env::join_paths(all).ok().map(|s| s.to_string_lossy().into_owned())
}

/// Was die Run-Leiste startet. Spiegel von `Target` in run.logic.ts.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    /// args hinter dem Script, z. B. ["dev"] fuer `npm run tauri dev`.
    Npm {
        pm: String,
        script: String,
        #[serde(default)]
        args: Vec<String>,
    },
    Dotnet { watch: bool },
    Cargo { bin: Option<String> },
    /// Eigenes Startziel: Befehlszeile, die der Nutzer selbst eingetragen hat; laeuft unveraendert in der Login-Shell.
    Shell { command: String },
}

/// Build-Profil der Run-Leiste: release haengt --release (cargo) bzw. -c Release (dotnet) an, args kommen hinten dran.
#[derive(serde::Deserialize, Default)]
pub struct Profile {
    #[serde(default)]
    release: bool,
    #[serde(default)]
    args: Vec<String>,
}

/// Zusatzargument eines Profils: Flags und Werte ohne Leerzeichen, Quotes oder Shell-Zeichen.
fn arg_ok(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "_.:=/@+,-".contains(c))
}

/// Script- bzw. Binary-Name, der ohne Quoting in die Shell darf.
fn name_ok(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || ":_.-".contains(c))
}

/// Kommando der Run-Leiste in cwd. Nur feste Woerter und gepruefte Namen erreichen die Shell (ausser Target::Shell,
/// dessen Befehl der Nutzer selbst getippt hat; Windows: pwsh bzw. PowerShell statt Login-Shell), darum bleibt es
/// ein Shell-String (Login-Shell wie das Terminal, auch fish). Prueft, dass das Ziel im Ordner existiert.
/// `ready` (nur Windows): Toolchain im App-PATH gefunden (`toolchain_ready`). `install`: der Nutzer hat der
/// Installation fehlender Teile (`missing`) zugestimmt; ohne wird nur gestartet, ein Fehler landet in der Ausgabe.
fn run_command(
    p: &Profile,
    windows: bool,
    t: &Target,
    cwd: &Path,
    env: impl Fn(&str) -> Option<String>,
    ready: bool,
    install: bool,
) -> Result<(String, Vec<String>), String> {
    if let Target::Shell { command } = t {
        let command = command.trim();
        if command.is_empty() {
            return Err("Leerer Befehl".into());
        }
        if windows {
            // pwsh (7+) kennt && und || wie die Login-Shell; Windows PowerShell 5.1 nur als Rueckfall.
            let ps = if crate::deps::on_path("pwsh") { "pwsh" } else { "powershell" };
            let args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command].map(String::from).to_vec();
            return Ok((ps.into(), args));
        }
        let sh = env("SHELL").filter(|s| !s.trim().is_empty()).unwrap_or_else(|| UNIX_SHELL.into());
        return Ok((sh, vec!["-lic".into(), command.into()]));
    }
    let npm_install = install && matches!(t, Target::Npm { .. }) && !has_node_modules(cwd);
    let mut words: Vec<&str> = match t {
        Target::Npm { pm, script, args } => {
            if !["npm", "pnpm", "yarn", "bun"].contains(&pm.as_str()) || !name_ok(script) || !args.iter().all(|a| arg_ok(a)) {
                return Err(format!("Nicht erlaubt: {pm} run {script}"));
            }
            let pkg = std::fs::read_to_string(cwd.join("package.json"))
                .map_err(|_| format!("Keine package.json in {}", cwd.display()))?;
            let has = serde_json::from_str::<serde_json::Value>(&pkg)
                .ok()
                .is_some_and(|v| v.get("scripts").and_then(|s| s.get(script)).is_some());
            if !has {
                return Err(format!("Script „{script}“ fehlt in package.json"));
            }
            let mut w = vec![pm.as_str(), "run", script];
            w.extend(args.iter().map(String::as_str));
            w
        }
        Target::Dotnet { watch } => {
            // Ohne --project: dotnet nimmt die eine Projektdatei im Ordner, kein Pfad in der Shell.
            let n = std::fs::read_dir(cwd).map_or(0, |d| {
                d.flatten()
                    .filter(|e| e.path().extension().is_some_and(|x| x == "csproj" || x == "fsproj"))
                    .count()
            });
            if n != 1 {
                return Err(format!("Genau eine .csproj/.fsproj erwartet in {}", cwd.display()));
            }
            vec!["dotnet", if *watch { "watch" } else { "run" }]
        }
        Target::Cargo { bin } => {
            if !cwd.join("Cargo.toml").is_file() {
                return Err(format!("Keine Cargo.toml in {}", cwd.display()));
            }
            if !bin.as_deref().is_none_or(name_ok) {
                return Err(format!("Nicht erlaubt: --bin {}", bin.as_deref().unwrap_or_default()));
            }
            let mut w = vec!["cargo", "run"];
            if let Some(b) = bin {
                w.extend(["--bin", b]);
            }
            w
        }
        Target::Shell { .. } => unreachable!("oben behandelt"),
    };
    if p.release {
        match t {
            Target::Cargo { .. } => words.push("--release"),
            Target::Dotnet { .. } => words.extend(["-c", "Release"]),
            // npm kennt kein Release, das Script ist das Profil.
            _ => {}
        }
    }
    if let Some(a) = p.args.iter().find(|a| !arg_ok(a)) {
        return Err(format!("Nicht erlaubtes Argument im Profil: {a}"));
    }
    words.extend(p.args.iter().map(String::as_str));
    let run = words.join(" ");
    let pm = match t {
        Target::Npm { pm, .. } => pm.as_str(),
        _ => "",
    };
    if windows {
        if !ready {
            // PowerShell, weil cmd nach winget den neuen PATH nicht kennt; nutzerlokale SDKs kommen per $env:PATH dazu.
            let mut ps = setup_windows(t, cwd, install);
            if npm_install {
                ps += &format!("& {pm} install; if (-not $?) {{ exit 1 }}; ");
            }
            // PowerShell: "a,b" waere ein Array, "@x" Splatting. arg_ok laesst kein ' zu, Quoten reicht.
            let quoted: Vec<String> = words.iter().map(|w| if w.contains([',', '@']) { format!("'{w}'") } else { (*w).to_string() }).collect();
            ps += &format!("& {}; exit $LASTEXITCODE", quoted.join(" "));
            let args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps].map(String::from).to_vec();
            return Ok(("powershell".into(), args));
        }
        // cmd loest die .cmd-Shims (npm.cmd, pnpm.cmd) auf.
        let mut all = vec!["/d", "/c"];
        if npm_install {
            all.extend([pm, "install", "&&"]);
        }
        all.extend(words);
        return Ok(("cmd.exe".into(), all.into_iter().map(String::from).collect()));
    }
    // Login-Shell wie das Terminal: PATH samt nvm/fnm. Ohne exec: npm darf auch eine Shell-Funktion sein (lazy nvm).
    let sh = env("SHELL")
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| UNIX_SHELL.into());
    let cmd = match t {
        Target::Npm { .. } if npm_install => format!("{pm} install && {run}"),
        Target::Npm { .. } => run,
        // POSIX-Vorspann (auch unter fish); die Woerter gehen als "$@" hinein.
        _ => format!("sh -c '{}exec \"$@\"' sh {run}", setup_unix(t, cwd, install)),
    };
    Ok((sh, vec!["-lic".into(), cmd]))
}

fn has_node_modules(cwd: &Path) -> bool {
    // Yarn PnP kommt ohne node_modules aus.
    cwd.join("node_modules").is_dir() || cwd.join(".pnp.cjs").is_file()
}

/// SDK fuer dotnet-install: Version aus global.json (auch in Elternordnern), sonst Kanal aus dem
/// TargetFramework (net8.0 -> 8.0), sonst LTS. Nur Werte, die ohne Quoting in die Shell duerfen.
fn dotnet_sdk(cwd: &Path) -> (&'static str, String) {
    let pinned = cwd
        .ancestors()
        .find_map(|d| std::fs::read_to_string(d.join("global.json")).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| Some(v.get("sdk")?.get("version")?.as_str()?.to_string()));
    if let Some(v) = pinned.filter(|v| name_ok(v)) {
        return ("version", v);
    }
    let tfm = std::fs::read_dir(cwd).into_iter().flatten().flatten().find_map(|e| {
        let ext = e.path().extension()?.to_owned();
        if ext != "csproj" && ext != "fsproj" {
            return None;
        }
        let text = std::fs::read_to_string(e.path()).ok()?;
        let rest = &text[text.find("<TargetFramework")?..];
        let ch: String = rest[rest.find('>')? + 1..].strip_prefix("net")?.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        ch.contains('.').then_some(ch)
    });
    ("channel", tfm.unwrap_or_else(|| "LTS".into()))
}

/// Ein fehlendes Teil fuer die Rueckfrage: was (name) und woher, wohin (detail).
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Need {
    name: String,
    detail: String,
}

/// Was vor dem Start fehlt. Leer = nichts zu installieren.
/// Unix prueft in der Login-Shell (erst die hat den vollen PATH); Node selbst nur unter Windows, weil nvm & Co.
/// npm als Shell-Funktion liefern und eine Pruefung von aussen es faelschlich vermissen wuerde.
fn missing(t: &Target, cwd: &Path, windows: bool, ok: impl Fn(&str) -> bool) -> Vec<Need> {
    let need = |name: String, detail: String| Need { name, detail };
    let mut out = Vec::new();
    match t {
        Target::Npm { pm, .. } => {
            if windows && !ok("npm") {
                out.push(need("Node.js LTS".into(), "per winget (OpenJS.NodeJS.LTS)".into()));
            }
            if windows && pm != "npm" && !ok(pm) {
                out.push(need(pm.clone(), format!("per npm install -g {pm}")));
            }
            if !has_node_modules(cwd) {
                out.push(need("Projekt-Pakete".into(), format!("aus package.json per {pm} install · nach node_modules")));
            }
        }
        Target::Dotnet { .. } if !ok("dotnet") => {
            let (_, v) = dotnet_sdk(cwd);
            let name = if v == "LTS" { ".NET SDK (LTS)".into() } else { format!(".NET SDK {v}") };
            let dir = if windows { r"%USERPROFILE%\.dotnet" } else { "~/.dotnet" };
            out.push(need(name, format!("offizielles dotnet-install-Skript von dot.net · nach {dir}")));
        }
        Target::Cargo { .. } if !ok("cargo") => out.push(if windows {
            need("Rust-Toolchain".into(), "per winget (Rustlang.Rustup)".into())
        } else {
            need("Rust-Toolchain".into(), "rustup von sh.rustup.rs · nach ~/.cargo und ~/.rustup".into())
        }),
        _ => {}
    }
    out
}

/// POSIX-Vorspann: nutzerlokale SDKs (~/.dotnet, ~/.cargo) nutzen, wenn das System keins hat; mit `install`
/// fehlende installieren. Keine einfachen Anfuehrungszeichen, das Skript steht selbst in welchen.
fn setup_unix(t: &Target, cwd: &Path, install: bool) -> String {
    match t {
        Target::Dotnet { .. } => {
            let (k, v) = dotnet_sdk(cwd);
            let get = if install {
                format!(
                    "if ! dotnet --version >/dev/null 2>&1; then echo \"[Atelier] Installiere .NET SDK nach ~/.dotnet\"; \
                     curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --install-dir \"$HOME/.dotnet\" --{k} {v} || exit 1; fi; "
                )
            } else {
                String::new()
            };
            format!(
                "if ! dotnet --version >/dev/null 2>&1; then export DOTNET_ROOT=\"$HOME/.dotnet\" PATH=\"$HOME/.dotnet:$PATH\"; fi; {get}"
            )
        }
        Target::Cargo { .. } => {
            let get = if install {
                "if ! command -v cargo >/dev/null 2>&1; then echo \"[Atelier] Installiere Rust per rustup\"; \
                 curl --proto =https --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y || exit 1; . \"$HOME/.cargo/env\"; fi; "
            } else {
                ""
            };
            format!("if ! command -v cargo >/dev/null 2>&1 && [ -f \"$HOME/.cargo/env\" ]; then . \"$HOME/.cargo/env\"; fi; {get}")
        }
        _ => String::new(),
    }
}

/// PowerShell-Vorspann fuer Windows: nutzerlokale Ordner in den PATH, mit `install` fehlende Teile installieren
/// (.NET per dotnet-install nach %USERPROFILE%\.dotnet, Rust und Node per winget, pnpm/yarn/bun per npm -g).
fn setup_windows(t: &Target, cwd: &Path, install: bool) -> String {
    const WINGET: &str = "-e --silent --accept-package-agreements --accept-source-agreements";
    let get = |test: &str, body: String| if install { format!("if (-not ({test})) {{ {body}; if (-not $?) {{ exit 1 }} }}; ") } else { String::new() };
    match t {
        Target::Dotnet { .. } => {
            let (k, v) = dotnet_sdk(cwd);
            let k = if k == "version" { "Version" } else { "Channel" };
            "$d = \"$env:USERPROFILE\\.dotnet\"; dotnet --version *> $null; \
             if ($LASTEXITCODE -ne 0) { $env:DOTNET_ROOT = $d; $env:PATH = \"$d;$env:PATH\" }; dotnet --version *> $null; "
                .to_string()
                + &get(
                    "$LASTEXITCODE -eq 0",
                    format!("Write-Host '[Atelier] Installiere .NET SDK nach' $d; & ([scriptblock]::Create((Invoke-RestMethod https://dot.net/v1/dotnet-install.ps1))) -InstallDir $d -{k} {v}"),
                )
        }
        Target::Cargo { .. } => {
            "$env:PATH = \"$env:USERPROFILE\\.cargo\\bin;$env:PATH\"; ".to_string()
                + &get("Get-Command cargo -ErrorAction SilentlyContinue", format!("winget install --id Rustlang.Rustup {WINGET}"))
        }
        Target::Npm { pm, .. } => {
            let mut ps = "$env:PATH = \"$env:ProgramFiles\\nodejs;$env:APPDATA\\npm;$env:PATH\"; ".to_string()
                + &get("Get-Command npm -ErrorAction SilentlyContinue", format!("winget install --id OpenJS.NodeJS.LTS {WINGET}"));
            if pm != "npm" {
                ps += &get(&format!("Get-Command {pm} -ErrorAction SilentlyContinue"), format!("npm install -g {pm}"));
            }
            ps
        }
        Target::Shell { .. } => String::new(),
    }
}

/// Windows: Toolchain fuer das Ziel im App-PATH (dort der volle, anders als bei macOS-GUI-Apps).
fn toolchain_ready(t: &Target, cwd: &Path) -> bool {
    match t {
        Target::Npm { pm, .. } => crate::deps::on_path("npm") && crate::deps::on_path(pm),
        Target::Cargo { .. } => crate::deps::on_path("cargo"),
        Target::Shell { .. } => true,
        // Nur das System-dotnet: ein nutzerlokales braucht den PowerShell-Vorspann fuer den PATH.
        Target::Dotnet { .. } => crate::quiet("dotnet")
            .arg("--version")
            .current_dir(cwd)
            .stdin(std::process::Stdio::null())
            .output()
            .is_ok_and(|o| o.status.success()),
    }
}

/// Ob ein Werkzeug laeuft. Windows: im App-PATH oder nutzerlokal; Unix: in der Login-Shell, auch nutzerlokal.
/// dotnet --version scheitert auch, wenn global.json ein fehlendes SDK verlangt.
fn tool_ok(cwd: &Path, name: &str) -> bool {
    let run = |cmd: &mut std::process::Command| cmd.current_dir(cwd).stdin(std::process::Stdio::null()).output().is_ok_and(|o| o.status.success());
    if cfg!(windows) {
        let local = crate::skills::home().join(match name {
            "dotnet" => r".dotnet\dotnet.exe",
            "cargo" => r".cargo\bin\cargo.exe",
            _ => "",
        });
        return match name {
            "dotnet" => run(crate::quiet("dotnet").arg("--version")) || (local.is_file() && run(crate::quiet(&local.to_string_lossy()).arg("--version"))),
            _ => crate::deps::on_path(name) || local.is_file(),
        };
    }
    let probe = match name {
        "dotnet" => "dotnet --version >/dev/null 2>&1 || \"$HOME/.dotnet/dotnet\" --version >/dev/null 2>&1",
        "cargo" => "command -v cargo >/dev/null 2>&1 || [ -x \"$HOME/.cargo/bin/cargo\" ]",
        _ => "false",
    };
    let sh = std::env::var("SHELL").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| UNIX_SHELL.into());
    run(crate::quiet(&sh).args(["-lic", &format!("sh -c '{probe}'")]))
}

/// `claude auth login` in einer PTY: oeffnet die Anmeldung im Browser, fragt evtl. nach einem Code. Ausgabe kommt
/// wie beim Terminal ueber `out`, das Ende als pty-exit:<id>.
#[tauri::command]
pub fn claude_login(app: AppHandle, ptys: State<'_, Ptys>, id: String, out: Channel<InvokeResponseBody>) -> Result<(), String> {
    let claude = crate::deps::claude_bin().ok_or("claude nicht gefunden")?;
    let home = crate::skills::home();
    spawn(app, &ptys, id, &home.to_string_lossy(), &claude.to_string_lossy(), vec!["auth".into(), "login".into()], 100, 30, &[], true, out)
}

/// Was vor dem Start von `target` installiert werden muesste; das Frontend fragt damit vor `run_start` nach.
#[tauri::command]
pub async fn run_missing(repo: String, dir: String, target: Target) -> Result<Vec<Need>, String> {
    let cwd = if dir.is_empty() { PathBuf::from(&repo) } else { crate::files::within(&repo, &dir)? };
    crate::git::blocking(move || {
        Ok(missing(&target, &cwd, cfg!(windows), |n| match n {
            "dotnet" | "cargo" => tool_ok(&cwd, n),
            _ => crate::deps::on_path(n),
        }))
    })
    .await
}

/// Projekt starten (dir = Ordner des Ziels, "" = Projektordner) in einem PTY. Output kommt wie beim Terminal ueber
/// `out`, das Ende als pty-exit:<id> (Exit-Code oder null), gestoppt wird mit pty_close.
/// Fuehrt Code aus dem Projekt aus: das Frontend ruft das nur auf Klick oder Taste.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn run_start(
    app: AppHandle,
    ptys: State<'_, Ptys>,
    id: String,
    repo: String,
    dir: String,
    target: Target,
    profile: Option<Profile>,
    install: Option<bool>,
    out: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let cwd = if dir.is_empty() { PathBuf::from(&repo) } else { crate::files::within(&repo, &dir)? };
    let ready = !cfg!(windows) || toolchain_ready(&target, &cwd);
    let install = install.unwrap_or(false);
    let (program, args) = run_command(&profile.unwrap_or_default(), cfg!(windows), &target, &cwd, |k| std::env::var(k).ok(), ready, install)?;
    let env: &[(&str, &str)] = match target {
        // Vite, CRA & Co. oeffnen sonst zusaetzlich den Browser.
        Target::Npm { .. } => &[("BROWSER", "none")],
        Target::Dotnet { .. } => &[("DOTNET_CLI_UI_LANGUAGE", "en")],
        Target::Cargo { .. } | Target::Shell { .. } => &[],
    };
    spawn(app, &ptys, id, &cwd.to_string_lossy(), &program, args, 120, 30, env, true, out)
}

/// Env-Marker einer umgebenden Claude-Session, die ein gestartetes claude nicht erben darf (siehe spawn).
pub(crate) const MARKERS: [&str; 12] = [
    "NO_COLOR",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDECODE",
    "AI_AGENT",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
];

/// Programm in einem neuen PTY starten: Output roh ueber `out`, Ende als Event pty-exit:<id>. tree: siehe Session.
#[allow(clippy::too_many_arguments)]
fn spawn(
    app: AppHandle,
    ptys: &Ptys,
    id: String,
    cwd: &str,
    program: &str,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    env: &[(&str, &str)],
    tree: bool,
    out: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(format!("Ungueltige Terminal-id: {id}"));
    }
    if !Path::new(cwd).is_dir() {
        return Err(format!("Ordner nicht gefunden: {cwd}"));
    }
    if ptys.lock().contains_key(&id) {
        return Err(format!("Terminal laeuft schon: {id}"));
    }

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("PTY konnte nicht geoeffnet werden: {e}"))?;

    let (exe, pre) = crate::native(program);
    let mut cmd = CommandBuilder::new(exe);
    cmd.args(pre);
    cmd.args(args);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for (k, v) in env {
        cmd.env(k, v);
    }

    // Aus einer Claude-Session gestartet (z. B. tauri dev) erben wir deren Marker;
    // das claude im Terminal haelt sich dann fuer einen Sub-Agent: keine Farben, kein Transcript.
    // NO_COLOR setzt Claude Code fuer seine Tool-Shells; ein Terminal soll trotzdem Farben zeigen.
    for key in MARKERS {
        cmd.env_remove(key);
    }

    // Sonst laufen claude und git im Terminal gegen unsere gebuendelten Bibliotheken.
    crate::unbundle_env(|key, val| match val {
        Some(v) => cmd.env(key, v),
        None => cmd.env_remove(key),
    });

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Shell konnte nicht gestartet werden: {e}"))?;
    // Unix: sonst haelt die App selbst den Slave offen und der Reader sieht nie EOF.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("PTY-Fehler: {e}"))?;
    let input = spawn_writer(pair.master.take_writer().map_err(|e| format!("PTY-Fehler: {e}"))?);

    let gen = NEXT_GEN.fetch_add(1, Ordering::Relaxed);
    ptys.lock().insert(
        id.clone(),
        Session {
            gen,
            input,
            master: pair.master,
            killer: child.clone_killer(),
            tree: child.process_id().filter(|_| tree),
        },
    );

    // Nur Claude-Terminals (nicht die Run-Leiste): laufendes Zeichnen zaehlt fuer den Wach-Halt als "arbeitet".
    let claude = (!tree).then(|| id.clone());
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                // Roh als Bytes: read() kann mitten in einer UTF-8-Sequenz enden.
                Ok(n) => {
                    if let Some(c) = &claude {
                        crate::awake::output(c);
                    }
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    std::thread::spawn(move || {
        let mut last = std::time::Instant::now();
        while let Some(chunk) = batch(&rx, last) {
            let _ = out.send(InvokeResponseBody::Raw(chunk));
            last = std::time::Instant::now();
        }
    });

    // Exit am Prozess erkennen, nicht am Reader: ConPTY schliesst die Pipe erst bei
    // ClosePseudoConsole (Drop des Masters). wait() raeumt unter Unix auch den Zombie ab.
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let Some(ptys) = app.try_state::<Ptys>() else { return };
        let mut map = ptys.lock();
        // Nach pty_close (oder bei neuer Session gleicher id) kein Exit melden.
        if map.get(&id).is_none_or(|s| s.gen != gen) {
            return;
        }
        let s = map.remove(&id);
        drop(map);
        // Master ausserhalb des Locks droppen, ClosePseudoConsole kann blockieren.
        drop(s);
        let _ = app.emit(&format!("pty-exit:{id}"), code);
    });
    Ok(())
}

/// Naechstes Paket fuer das Frontend; None, wenn der Reader fertig ist. Ein PTY liefert unter macOS hoechstens
/// ~1 KB je read(); einzeln kostet jede Nachricht im Webview mehr als ihr Inhalt. Darum: nach einer Pause
/// (`last` = letztes Senden, Tastenecho) sofort, im laufenden Strom bis zu 4 ms bzw. 256 KB sammeln.
fn batch(rx: &std::sync::mpsc::Receiver<Vec<u8>>, last: std::time::Instant) -> Option<Vec<u8>> {
    use std::time::{Duration, Instant};
    let mut chunk = rx.recv().ok()?;
    let idle = last.elapsed() > Duration::from_millis(16);
    let until = Instant::now() + Duration::from_millis(4);
    while chunk.len() < 256 << 10 {
        let next = match rx.try_recv() {
            Ok(b) => b,
            Err(_) if idle => break,
            Err(_) => match rx.recv_timeout(until.saturating_duration_since(Instant::now())) {
                Ok(b) => b,
                Err(_) => break,
            },
        };
        chunk.extend_from_slice(&next);
    }
    Some(chunk)
}

/// Endet, wenn die Session (Sender) wegfaellt oder das Schreiben scheitert; dann meldet send den Fehler.
fn spawn_writer(mut w: Box<dyn Write + Send>) -> Sender<Vec<u8>> {
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        for b in rx {
            if w.write_all(&b).and_then(|_| w.flush()).is_err() {
                break;
            }
        }
    });
    tx
}

fn write(ptys: &Ptys, id: &str, data: String) -> Result<(), String> {
    let map = ptys.lock();
    let s = map.get(id).ok_or_else(|| format!("Kein Terminal: {id}"))?;
    s.input.send(data.into_bytes()).map_err(|_| "Schreiben fehlgeschlagen: Terminal nimmt keine Eingabe mehr an".into())
}

#[tauri::command]
pub fn pty_write(ptys: State<'_, Ptys>, id: String, data: String) -> Result<(), String> {
    write(&ptys, &id, data)
}

#[tauri::command]
pub fn pty_resize(ptys: State<'_, Ptys>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = ptys.lock();
    let s = map.get(&id).ok_or_else(|| format!("Kein Terminal: {id}"))?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Resize fehlgeschlagen: {e}"))
}

/// Async: kill() wartet bis zu 1 s, ein Sync-Command liefe auf dem Main-Thread und froere die UI ein.
#[tauri::command]
pub async fn pty_close(ptys: State<'_, Ptys>, ides: State<'_, crate::ide::Ides>, id: String) -> Result<(), String> {
    ides.stop(&id);
    crate::awake::forget(&id);
    // Auch wenn der Prozess schon selbst endete (dann fehlt der Eintrag).
    if valid_id(&id) {
        let _ = std::fs::remove_file(crate::activity::panel_file(&id));
        let _ = std::fs::remove_file(crate::activity::panel_file(&id).with_extension("cmd"));
    }
    let Some(mut s) = ptys.lock().remove(&id) else { return Ok(()) };
    crate::git::blocking(move || {
        s.kill();
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{plugin_dirs, run_command, shell, theme_for, valid_id, Profile, Target, UNIX_SHELL};

    /// Jede Datei der Mod muss in FILES stehen, sonst fehlt sie im Release.
    #[test]
    fn mod_files_vollstaendig() {
        fn walk(dir: &std::path::Path, root: &std::path::Path, out: &mut Vec<String>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                // Nicht ausgeliefert: von claude erzeugte Typen, Tests, Dev-tsconfig (erbt aus den Typen).
                let skip = [".DS_Store", "node_modules"].contains(&&*e.file_name().to_string_lossy());
                if skip || ["tests", ".claude-plugin/types", "tsconfig.json"].contains(&rel.as_str()) {
                    continue;
                }
                if p.is_dir() { walk(&p, root, out) } else { out.push(rel) }
            }
        }
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("mods/open-claude");
        let mut found = Vec::new();
        walk(&root, &root, &mut found);
        let missing: Vec<_> = found.iter().filter(|f| !super::FILES.iter().any(|(r, _)| r == f)).collect();
        assert!(missing.is_empty(), "nicht in FILES (pty.rs): {missing:?}");
    }

    /// Lasttest: 16 MB an ein Kind, das nie liest (sleep), duerfen weder den Aufrufer noch den Map-Lock
    /// noch eine zweite Session aufhalten.
    #[cfg(unix)]
    #[test]
    fn blockierender_writer_haelt_nichts_auf() {
        use super::{spawn_writer, write, Ptys, Session};
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::Read;
        use std::time::{Duration, Instant};
        let open = |prog: &str, args: &[&str]| {
            let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
            let mut cmd = CommandBuilder::new(prog);
            cmd.args(args);
            let child = pair.slave.spawn_command(cmd).unwrap();
            drop(pair.slave);
            let reader = pair.master.try_clone_reader().unwrap();
            let input = spawn_writer(pair.master.take_writer().unwrap());
            (Session { gen: 0, input, master: pair.master, killer: child.clone_killer(), tree: None }, reader)
        };
        let ptys = Ptys::default();
        // Roh wie claude: sonst verwirft die Zeilendisziplin ueberzaehlige Bytes, statt zu blockieren.
        let (a, _ra) = open("sh", &["-c", "stty raw -echo; sleep 30"]);
        let (b, mut rb) = open("cat", &[]);
        ptys.lock().insert("a".into(), a);
        ptys.lock().insert("b".into(), b);

        let t = Instant::now();
        write(&ptys, "a", "x".repeat(8 << 20)).unwrap();
        write(&ptys, "a", "y".repeat(8 << 20)).unwrap();
        let sent = t.elapsed();
        let t = Instant::now();
        drop(ptys.lock());
        let locked = t.elapsed();
        write(&ptys, "b", "hallo\n".into()).unwrap();
        let mut got = Vec::new();
        let mut buf = [0u8; 256];
        let t = Instant::now();
        while !String::from_utf8_lossy(&got).contains("hallo") && t.elapsed() < Duration::from_secs(5) {
            let n = rb.read(&mut buf).unwrap();
            got.extend_from_slice(&buf[..n]);
        }
        eprintln!("16 MB an blockiertes Kind: {sent:?}, Lock danach: {locked:?}, zweite Session: {:?}", t.elapsed());
        assert!(String::from_utf8_lossy(&got).contains("hallo"));
        assert!(sent < Duration::from_millis(500) && locked < Duration::from_millis(50));
        for (_, mut s) in ptys.lock().drain() {
            let _ = s.killer.kill();
        }
    }

    #[test]
    fn batch_sammelt_nur_was_ansteht() {
        use super::batch;
        use std::time::{Duration, Instant};
        let (tx, rx) = std::sync::mpsc::channel();
        let idle = Instant::now() - Duration::from_secs(1);
        // Tastenecho nach einer Pause: sofort, ohne die 4 ms abzuwarten
        tx.send(b"a".to_vec()).unwrap();
        let t = Instant::now();
        assert_eq!(batch(&rx, idle).unwrap(), b"a");
        assert!(t.elapsed() < Duration::from_millis(2));
        // Was schon ansteht, geht als ein Paket raus
        for c in [b"ab".to_vec(), vec![b'x'; 2000], b"cd".to_vec()] {
            tx.send(c).unwrap();
        }
        assert_eq!(batch(&rx, idle).unwrap().len(), 2004);
        // Im Strom (gerade gesendet): Nachzuegler innerhalb von 4 ms kommen mit
        let late = tx.clone();
        let t = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1));
            late.send(b"b".to_vec()).unwrap();
        });
        tx.send(b"a".to_vec()).unwrap();
        assert_eq!(batch(&rx, Instant::now()).unwrap(), b"ab");
        t.join().unwrap();
        // Obergrenze 256 KB, Rest im naechsten Paket
        for _ in 0..60 {
            tx.send(vec![0; 8192]).unwrap();
        }
        let first = batch(&rx, idle).unwrap().len();
        assert!((256 << 10..(256 << 10) + 8192).contains(&first), "{first}");
        assert_eq!(first + batch(&rx, idle).unwrap().len(), 60 * 8192);
        drop(tx);
        assert!(batch(&rx, idle).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn agent_zeilen_mit_leerem_content() {
        use super::HIDE_AGENTS;
        use std::io::Write;
        let mut sh = std::process::Command::new("sh")
            .args(["-c", HIDE_AGENTS])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let input = r#"{"session_id":"s","tasks":[{"id":"a1","name":"x","status":"running"},{"id":"b-2","cwd":"/p"}]}"#;
        sh.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
        let out = String::from_utf8(sh.wait_with_output().unwrap().stdout).unwrap();
        let lines: Vec<serde_json::Value> = out.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines, [serde_json::json!({"id": "a1", "content": ""}), serde_json::json!({"id": "b-2", "content": ""})]);
    }

    #[test]
    fn plugin_dirs_haengt_an() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let m = |v: &[&str]| v.iter().map(std::path::PathBuf::from).collect::<Vec<_>>().into_iter();
        assert_eq!(plugin_dirs(Some("/x".into()), m(&[])), None);
        assert_eq!(plugin_dirs(None, m(&["/a", "/b"])), Some(format!("/a{sep}/b")));
        assert_eq!(plugin_dirs(Some(String::new()), m(&["/a"])), Some("/a".into()));
        assert_eq!(plugin_dirs(Some(format!("/x{sep}/y")), m(&["/a"])), Some(format!("/x{sep}/y{sep}/a")));
        // Geerbte Release-Mod gleichen Namens wird durch die eigene ersetzt
        assert_eq!(plugin_dirs(Some(format!("/rel/open-claude{sep}/x")), m(&["/dev/open-claude"])), Some(format!("/x{sep}/dev/open-claude")));
    }

    fn tmp(name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("ocui-run-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        for (f, text) in files {
            std::fs::write(d.join(f), text).unwrap();
        }
        d
    }

    #[test]
    fn run_kommando_nur_feste_werte() {
        let env = |k: &str| (k == "SHELL").then(|| "/bin/fish".to_string());
        let npm = |pm: &str, s: &str| Target::Npm { pm: pm.into(), script: s.into(), args: vec![] };
        let d = tmp("npm", &[("package.json", r#"{"scripts":{"dev":"vite","tauri:dev":"x","-x":"y"}}"#)]);
        // Ohne node_modules wird vorher installiert
        assert_eq!(run_command(&Profile::default(), false, &npm("pnpm", "dev"), &d, env, true, true).unwrap().1, ["-lic", "pnpm install && pnpm run dev"]);
        std::fs::create_dir(d.join("node_modules")).unwrap();
        let (p, a) = run_command(&Profile::default(), false, &npm("pnpm", "dev"), &d, env, true, false).unwrap();
        assert_eq!(p, "/bin/fish");
        assert_eq!(a, ["-lic", "pnpm run dev"]);
        assert_eq!(run_command(&Profile::default(), false, &npm("npm", "tauri:dev"), &d, |_| None, true, false).unwrap().0, UNIX_SHELL);
        let (p, a) = run_command(&Profile::default(), true, &npm("yarn", "dev"), &d, env, true, false).unwrap();
        assert_eq!(p, "cmd.exe");
        assert_eq!(a, ["/d", "/c", "yarn", "run", "dev"]);
        assert!(run_command(&Profile::default(), false, &npm("npm; rm -rf ~", "dev"), &d, env, true, false).is_err());
        // Fehlt in package.json, Sonderzeichen, Option.
        for s in ["build", "dev & calc", "$(x)", "-x", ""] {
            assert!(run_command(&Profile::default(), true, &npm("npm", s), &d, env, true, false).is_err(), "{s}");
        }
        assert!(run_command(&Profile::default(), false, &npm("npm", "dev"), &d.join("fehlt"), env, true, false).is_err());
        // Script-Argumente (tauri dev) nur mit erlaubten Zeichen.
        let with = |a: &str| Target::Npm { pm: "npm".into(), script: "dev".into(), args: vec![a.into()] };
        assert_eq!(run_command(&Profile::default(), false, &with("--host"), &d, env, true, false).unwrap().1, ["-lic", "npm run dev --host"]);
        assert!(run_command(&Profile::default(), false, &with("x;y"), &d, env, true, false).is_err());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn run_eigener_befehl() {
        let env = |k: &str| (k == "SHELL").then(|| "/bin/zsh".to_string());
        let sh = |c: &str| Target::Shell { command: c.into() };
        let d = std::env::temp_dir();
        assert_eq!(run_command(&Profile::default(), false, &sh(" npm run tauri dev "), &d, env, true, false).unwrap(), ("/bin/zsh".into(), vec!["-lic".into(), "npm run tauri dev".into()]));
        assert!(["pwsh", "powershell"].contains(&run_command(&Profile::default(), true, &sh("cargo tauri dev"), &d, env, true, false).unwrap().0.as_str()));
        assert!(run_command(&Profile::default(), false, &sh("  "), &d, env, true, false).is_err());
    }

    #[test]
    fn profil_release_und_args() {
        let d = std::env::temp_dir().join(format!("ocui-profil-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("Cargo.toml"), "").unwrap();
        std::fs::write(d.join("a.csproj"), "").unwrap();
        let env = |_: &str| None;
        let rel = |args: &[&str]| Profile { release: true, args: args.iter().map(|s| s.to_string()).collect() };
        let cargo = Target::Cargo { bin: None };
        assert!(run_command(&rel(&["--features", "x,y", "--", "--port=3000"]), false, &cargo, &d, env, true, false).unwrap().1[1].ends_with("' sh cargo run --release --features x,y -- --port=3000"));
        assert_eq!(run_command(&rel(&[]), true, &Target::Dotnet { watch: false }, &d, env, true, false).unwrap().1, ["/d", "/c", "dotnet", "run", "-c", "Release"]);
        for bad in ["a b", "x;rm", "$(id)", "a&b", "%PATH%", "\"q\"", ""] {
            assert!(run_command(&rel(&[bad]), false, &cargo, &d, env, true, false).is_err(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn run_dotnet_und_cargo() {
        let env = |_: &str| None;
        let one = tmp("dn1", &[("App.csproj", "")]);
        let (_, a) = run_command(&Profile::default(), false, &Target::Dotnet { watch: true }, &one, env, true, false).unwrap();
        assert!(a[1].starts_with("sh -c '") && a[1].ends_with("' sh dotnet watch"), "{a:?}");
        let (_, a) = run_command(&Profile::default(), true, &Target::Dotnet { watch: false }, &one, env, true, false).unwrap();
        assert_eq!(a, ["/d", "/c", "dotnet", "run"]);
        let two = tmp("dn2", &[("A.csproj", ""), ("B.fsproj", "")]);
        assert!(run_command(&Profile::default(), false, &Target::Dotnet { watch: false }, &two, env, true, false).is_err());
        let none = tmp("dn0", &[]);
        assert!(run_command(&Profile::default(), false, &Target::Dotnet { watch: false }, &none, env, true, false).is_err());

        let c = tmp("cargo", &[("Cargo.toml", "[package]")]);
        let cargo = |b: Option<&str>| Target::Cargo { bin: b.map(String::from) };
        assert!(run_command(&Profile::default(), false, &cargo(None), &c, env, true, false).unwrap().1[1].ends_with("' sh cargo run"));
        assert_eq!(run_command(&Profile::default(), true, &cargo(Some("ocui-sh")), &c, env, true, false).unwrap().1, ["/d", "/c", "cargo", "run", "--bin", "ocui-sh"]);
        assert!(run_command(&Profile::default(), false, &cargo(Some("a b")), &c, env, true, false).is_err());
        assert!(run_command(&Profile::default(), false, &cargo(None), &none, env, true, false).is_err());
        for d in [one, two, none, c] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn toolchain_vorspann() {
        use super::{dotnet_sdk, missing};
        let env = |_: &str| None;
        // SDK: global.json (auch im Elternordner) vor TargetFramework vor LTS
        let p = tmp("sdk", &[("global.json", r#"{"sdk":{"version":"8.0.404"}}"#)]);
        std::fs::create_dir_all(p.join("app")).unwrap();
        std::fs::write(p.join("app/App.csproj"), "<TargetFramework>net9.0</TargetFramework>").unwrap();
        assert_eq!(dotnet_sdk(&p.join("app")), ("version", "8.0.404".into()));
        let t = tmp("tfm", &[("App.csproj", "<TargetFrameworks>net6.0;net48</TargetFrameworks>")]);
        assert_eq!(dotnet_sdk(&t), ("channel", "6.0".into()));
        let l = tmp("lts", &[("App.csproj", "<TargetFramework>netstandard2.0</TargetFramework>")]);
        assert_eq!(dotnet_sdk(&l), ("channel", "LTS".into()));
        let bad = tmp("sdkbad", &[("global.json", r#"{"sdk":{"version":"8; rm -rf ~"}}"#), ("App.csproj", "")]);
        assert_eq!(dotnet_sdk(&bad), ("channel", "LTS".into()));

        // Rueckfrage-Liste: was fehlt, mit Herkunft
        let dn = Target::Dotnet { watch: false };
        assert!(missing(&dn, &p.join("app"), false, |_| true).is_empty());
        let m = missing(&dn, &p.join("app"), false, |_| false);
        assert_eq!((m[0].name.as_str(), m[0].detail.as_str()), (".NET SDK 8.0.404", "offizielles dotnet-install-Skript von dot.net · nach ~/.dotnet"));
        let n = tmp("node", &[("package.json", r#"{"scripts":{"dev":"vite"}}"#)]);
        let npm = Target::Npm { pm: "pnpm".into(), script: "dev".into(), args: vec![] };
        assert_eq!(missing(&npm, &n, false, |_| false)[0].detail, "aus package.json per pnpm install · nach node_modules");
        assert_eq!(missing(&npm, &n, true, |c| c == "npm").len(), 2);
        assert_eq!(missing(&npm, &n, true, |_| false)[0].name, "Node.js LTS");

        // Ohne Zustimmung nichts installieren, auch kein npm install
        assert_eq!(run_command(&Profile::default(), false, &npm, &n, env, true, false).unwrap().1, ["-lic", "pnpm run dev"]);
        assert_eq!(run_command(&Profile::default(), false, &npm, &n, env, true, true).unwrap().1, ["-lic", "pnpm install && pnpm run dev"]);
        let c = tmp("cargo2", &[("Cargo.toml", "")]);
        for install in [false, true] {
            for (target, dir) in [(&dn, &t), (&Target::Cargo { bin: None }, &c)] {
                let cmd = run_command(&Profile::default(), false, target, dir, env, true, install).unwrap().1.remove(1);
                assert_eq!(cmd.contains("curl"), install, "{cmd}");
                let script = &cmd["sh -c '".len()..cmd.rfind("' sh ").unwrap()];
                assert!(std::process::Command::new("sh").args(["-n", "-c", script]).status().unwrap().success(), "{script}");
            }
        }

        // Windows: vorhandene Toolchain bleibt bei cmd, sonst PowerShell; installiert nur mit Zustimmung
        assert_eq!(run_command(&Profile::default(), true, &npm, &n, env, true, true).unwrap().1, ["/d", "/c", "pnpm", "install", "&&", "pnpm", "run", "dev"]);
        let ps = run_command(&Profile::default(), true, &npm, &n, env, false, false).unwrap().1.remove(4);
        assert!(!ps.contains("winget") && ps.ends_with("& pnpm run dev; exit $LASTEXITCODE"), "{ps}");
        let (prog, a) = run_command(&Profile::default(), true, &npm, &n, env, false, true).unwrap();
        assert_eq!(prog, "powershell");
        let ps = a.last().unwrap();
        assert!(ps.contains("OpenJS.NodeJS.LTS") && ps.contains("npm install -g pnpm") && ps.contains("& pnpm install"), "{ps}");
        let ps = run_command(&Profile::default(), true, &dn, &p.join("app"), env, false, true).unwrap().1.remove(4);
        assert!(ps.contains("-Version 8.0.404") && ps.ends_with("& dotnet run; exit $LASTEXITCODE"), "{ps}");
        for d in [p, t, l, bad, c, n] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    fn run(windows: bool, env: &[(&str, &str)], files: &[&str]) -> (String, Vec<String>) {
        shell(
            windows,
            OWN,
            false,
            |k| env.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string()),
            |p| files.contains(&p),
        )
    }

    const WIN_ENV: &[(&str, &str)] = &[
        ("ProgramFiles", "C:\\Program Files"),
        ("LOCALAPPDATA", "C:\\Users\\m\\AppData\\Local"),
        ("PATH", "C:\\Windows;D:\\Tools\\Git\\cmd;C:\\ps"),
    ];

    const OWN: &str = "C:\\app\\ocui-sh.exe";

    #[test]
    fn eigene_shell_hat_vorrang() {
        let bash = "C:\\Program Files\\Git\\bin\\bash.exe";
        assert_eq!(run(true, WIN_ENV, &[OWN, bash]), (OWN.to_string(), vec![]));
        // Unix: ocui-sh ist fuer Git-Bash gebaut, direkt die Login-Shell.
        assert_eq!(run(false, &[("SHELL", "/bin/zsh")], &[OWN]).0, "/bin/zsh");
    }

    #[test]
    fn windows_bevorzugt_git_bash_in_reihenfolge() {
        let pf = "C:\\Program Files\\Git\\bin\\bash.exe";
        let la = "C:\\Users\\m\\AppData\\Local\\Programs\\Git\\bin\\bash.exe";
        let git = "D:\\Tools\\Git\\cmd\\git.exe";
        let via_path = "D:\\Tools\\Git\\bin\\bash.exe";

        let (p, a) = run(true, WIN_ENV, &[pf, la, git, via_path]);
        assert_eq!(p, pf);
        assert_eq!(a, ["-lic", "claude; exec bash -li"]);
        assert_eq!(run(true, WIN_ENV, &[la, git, via_path]).0, la);
        assert_eq!(run(true, WIN_ENV, &[git, via_path]).0, via_path);
        // git.exe unter mingw64\bin -> zwei Ebenen hoch.
        let env = [("PATH", "E:\\Git\\mingw64\\bin")];
        let files = ["E:\\Git\\mingw64\\bin\\git.exe", "E:\\Git\\bin\\bash.exe"];
        assert_eq!(run(true, &env, &files).0, "E:\\Git\\bin\\bash.exe");
    }

    #[test]
    fn windows_faellt_auf_pwsh_dann_cmd_zurueck() {
        let (p, a) = run(true, WIN_ENV, &["C:\\ps\\pwsh.exe"]);
        assert_eq!(p, "C:\\ps\\pwsh.exe");
        assert_eq!(a, ["-NoExit", "-Command", "claude"]);
        // git ohne bash daneben zaehlt nicht.
        let (p, a) = run(true, WIN_ENV, &["D:\\Tools\\Git\\cmd\\git.exe"]);
        assert_eq!(p, "cmd.exe");
        assert_eq!(a, ["/k", "claude"]);
        assert_eq!(run(true, &[], &[]).0, "cmd.exe");
    }

    #[test]
    fn unix_nimmt_shell_sonst_bash() {
        let (p, a) = run(false, &[("SHELL", "/bin/zsh")], &[]);
        assert_eq!(p, "/bin/zsh");
        assert_eq!(a, ["-lic", "claude; exec /bin/zsh -li"]);
        assert_eq!(run(false, &[], &[]).0, UNIX_SHELL);
        assert_eq!(run(false, &[("SHELL", " ")], &[]).0, UNIX_SHELL);
    }

    #[test]
    fn settings_nur_mit_flag() {
        let s = |w| shell(w, OWN, true, |k| (k == "SHELL").then(|| "/bin/fish".into()), |p| p == "C:\\ps\\pwsh.exe" || p == OWN);
        assert_eq!(s(false).1, ["-lic", "claude --settings \"$OPEN_CLAUDE_SETTINGS\"; exec /bin/fish -li"]);
        // ocui-sh liest die Env selbst.
        assert_eq!(s(true).0, OWN);
    }

    #[test]
    fn gruppe_als_zusatzordner() {
        let v: serde_json::Value = serde_json::from_str(&super::settings_json("dark", None, &["/w/api".into()])).unwrap();
        assert_eq!(v["permissions"]["additionalDirectories"], serde_json::json!(["/w/api"]));
        let v: serde_json::Value = serde_json::from_str(&super::settings_json("dark", None, &[])).unwrap();
        assert!(v.get("permissions").is_none());
    }

    #[test]
    fn theme_nur_zwischen_eigenen() {
        assert_eq!(theme_for("custom:open-claude:open-claude", "light"), Some("custom:open-claude:open-claude-light"));
        assert_eq!(theme_for("custom:open-claude:open-claude-light", "dark"), Some("custom:open-claude:open-claude"));
        assert_eq!(theme_for("custom:open-claude:open-claude", "dark"), None);
        assert_eq!(theme_for("auto", "light"), None);
        assert_eq!(theme_for("dark", "light"), None);
        assert_eq!(theme_for("custom:open-claude:open-claude", "system"), None);
    }

    #[test]
    fn id_nur_sichere_zeichen() {
        assert!(valid_id("repo_1-a"));
        assert!(!valid_id(""));
        assert!(!valid_id("a:b"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("ä"));
    }
}
