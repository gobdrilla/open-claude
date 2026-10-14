<script lang="ts">
  import { age, altKey, cn } from "$lib/utils";
  import { onMount, tick, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { homeDir } from "@tauri-apps/api/path";
  import { open } from "@tauri-apps/plugin-dialog";
  import { load, type Store } from "@tauri-apps/plugin-store";
  import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { check, type Update } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";

  import * as Command from "$lib/components/ui/command/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import SunMoonIcon from "@lucide/svelte/icons/sun-moon";
  import LaptopIcon from "@lucide/svelte/icons/laptop";
  import { theme, setMode } from "$lib/theme.svelte";
  import { ConfirmDialog, Segmented, menuContent, menuItem, menuSeparator } from "$lib/components/kit";
  import { answer, confirm, confirming } from "$lib/confirm.svelte";
  import { pasted } from "$lib/pasteimg.svelte";
  import RefreshIcon from "@lucide/svelte/icons/refresh-cw";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import KeyboardIcon from "@lucide/svelte/icons/keyboard";
  import StarIcon from "@lucide/svelte/icons/star";
  import PowerIcon from "@lucide/svelte/icons/power";
  import CircleQuestionMarkIcon from "@lucide/svelte/icons/circle-question-mark";
  import { ASKS, noAsk, setNoAsk, type AskKey } from "$lib/ask.svelte";
  import InboxIcon from "@lucide/svelte/icons/inbox";
  import GhostIcon from "@lucide/svelte/icons/ghost";
  import VolumeIcon from "@lucide/svelte/icons/volume-2";
  import MinusIcon from "@lucide/svelte/icons/minus";
  import SquareIcon from "@lucide/svelte/icons/square";
  import XIcon from "@lucide/svelte/icons/x";
  import LayersIcon from "@lucide/svelte/icons/layers";
  import GroupDialog, { type RepoGroup } from "$lib/components/GroupDialog.svelte";
  import ClaudeAccountsDialog from "$lib/components/ClaudeAccountsDialog.svelte";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import BotIcon from "@lucide/svelte/icons/bot";
  import ClaudeSettingsDialog from "$lib/components/ClaudeSettingsDialog.svelte";
  import { ContextMenu, DropdownMenu } from "bits-ui";
  import Notice from "$lib/components/Notice.svelte";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import { fuzzy } from "$lib/fuzzy";
  import { clampZoom, zoomKey, zoomStep, ZOOM_MAX, ZOOM_MIN } from "$lib/zoom";
  import ZoomInIcon from "@lucide/svelte/icons/zoom-in";
  import IdleAmongUs from "$lib/components/IdleAmongUs.svelte";
  import Terminal from "$lib/components/Terminal.svelte";
  import ClaudeBar from "$lib/components/ClaudeBar.svelte";
  import { tabState, type TabState } from "$lib/claudemode";
  import ActivityPanel from "$lib/components/ActivityPanel.svelte";
  import Splitter, { stored } from "$lib/components/Splitter.svelte";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";
  import GitView from "$lib/components/git/GitView.svelte";
  import EditorView from "$lib/components/editor/EditorView.svelte";
  import { drop, isDirty, open as openFile } from "$lib/editor.svelte";
  import { stop as stopLsp } from "$lib/lsp.svelte";
  import { ide, listenIde } from "$lib/ide.svelte";
  import { testCancel } from "$lib/testing.svelte";
  import { listen } from "@tauri-apps/api/event";
  import IdeDiff from "$lib/components/IdeDiff.svelte";
  import { runStop } from "$lib/run.svelte";
  import { editorDirty } from "$lib/files";
  import FileCodeIcon from "@lucide/svelte/icons/file-code";
  import CloneDialog from "$lib/components/git/CloneDialog.svelte";
  import CreateDialog from "$lib/components/git/CreateDialog.svelte";
  import RootDialog from "$lib/components/RootDialog.svelte";
  import AccountsDialog from "$lib/components/git/AccountsDialog.svelte";
  import { git, forge, type Account } from "$lib/git";
  import { unity, unityBadgeText, type UnityInfo } from "$lib/unity";
  import UnityCloseDialog from "$lib/components/unity/UnityCloseDialog.svelte";
  import ProfilesDialog from "$lib/components/skills/ProfilesDialog.svelte";
  import { sync, touched, profileFor, managed, pkey, emptyProject, type SkillStore, type ProjectSkills } from "$lib/skills";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import FolderInputIcon from "@lucide/svelte/icons/folder-input";
  import UsersIcon from "@lucide/svelte/icons/users";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import FolderDownIcon from "@lucide/svelte/icons/folder-down";
  import PaletteIcon from "@lucide/svelte/icons/palette";
  import PackageIcon from "@lucide/svelte/icons/package";
  import BrainIcon from "@lucide/svelte/icons/brain";
  import GaugeIcon from "@lucide/svelte/icons/gauge";
  import { readClaude, setClaude, type ClaudeCfg } from "$lib/claudeSettings";

  type Repo = {
    path: string;
    rel: string;
    branch: string;
    last_commit: string;
    langs: string[];
    /** Projekttyp (Unity, Tauri, ...); fehlt in alten Caches. */
    kind?: string | null;
  };

  // Farben wie auf GitHub, damit die Sprache ohne Lesen erkennbar ist.
  const LANG_COLOR: Record<string, string> = {
    Rust: "#dea584",
    Go: "#00add8",
    "C#": "#178600",
    "F#": "#b845fc",
    Python: "#3572a5",
    Java: "#b07219",
    Kotlin: "#a97bff",
    PHP: "#4f5d95",
    Ruby: "#701516",
    Swift: "#f05138",
    "C++": "#f34b7d",
    TypeScript: "#3178c6",
    JavaScript: "#f1e05a",
    Unity: "#a4a4a4",
    Tauri: "#24c8db",
    Godot: "#478cbf",
    Unreal: "#a4a4a4",
    Flutter: "#02569b",
    "Next.js": "#a4a4a4",
    Nuxt: "#00dc82",
    SvelteKit: "#ff3e00",
    Angular: "#dd0031",
    Django: "#44b78b",
  };
  type Cache = { root: string; repos: Repo[]; at: number };

  const isUnity = (repo: Repo) => repo.kind === "Unity";
  /** Badges: der Projekttyp sagt mehr als die Sprache (Unity statt C#). */
  const tags = (repo: Repo) => (repo.kind ? [repo.kind] : (repo.langs ?? []));

  // raw: die Store-Instanz nicht proxien; null bis onMount geladen hat.
  let store = $state.raw<Store>(null!);
  // Leer = ohne Dev-Ordner, dann nur die einzeln hinzugefuegten Projekte (extra).
  let root = $state("");
  let extra = $state<string[]>([]);
  let home = $state("");
  let repos = $state<Repo[]>([]);
  let query = $state("");
  let selected = $state("");
  let error = $state("");
  let scanning = $state(true);
  let scannedAt = $state(0);
  let fromCache = $state(false);
  let help = $state(false);
  let pins = $state<string[]>([]);
  let autostart = $state(false);
  let tray = $state(true);
  // Zugeklappt wach, nur solange Claude arbeitet (src-tauri/src/awake.rs); Standard aus.
  let lidAwake = $state(false);
  // Among-Us-Easteregg: rate ist der Faktor auf die Wartezeiten (groesser = seltener).
  let amongUs = $state({ on: true, rate: 1, volume: 1 });
  const RATES: [string, number][] = [["Selten", 3], ["Normal", 1], ["Oft", 0.4]];
  let input = $state<HTMLInputElement | null>(null);
  // Eine Session pro Projekt; die Tab-Leiste ueber dem Terminal wechselt zwischen ihnen.
  // group/dirs: Sitzung einer Repo-Gruppe, startet in repo und kennt dirs als weitere Arbeitsordner
  let sessions = $state<{ id: string; repo: Repo; group?: string; dirs?: string[] }[]>([]);
  let repoGroups = $state<RepoGroup[]>([]);
  // Gruppe im Dialog; orig = bisheriger Name (null = neu)
  let groupEdit = $state<{ orig: string | null; g: RepoGroup } | null>(null);
  let active = $state<string | null>(null);
  // Berechtigungsmodus je Session, gelesen aus der Terminal-Fusszeile (Kopfleiste)
  let modes = $state<Record<string, string>>({});
  // Tab-Status je Session aus dem Panel der Mod: laeuft, Rueckfrage, fertig (bis angesehen)
  let tabs = $state<Record<string, TabState>>({});
  const TAB: Record<string, [string, string, string]> = {
    run: ["◐", "text-primary animate-pulse", "Claude arbeitet"],
    ask: ["?", "text-warning font-bold", "Claude wartet auf dich"],
    done: ["✓", "text-success", "Claude ist fertig"],
  };
  const activeSession = $derived(sessions.find((s) => s.id === active));
  // Tab hervorheben: im Terminal die aktive Sitzung, sonst das Projekt der Ansicht (Gruppen nur im Terminal)
  const tabOn = (s: (typeof sessions)[number]) => (view === "term" ? s.id === active : !s.group && s.repo.path === viewRepo?.path);
  // Aktivitaets-Panel rechts neben dem Terminal: Breite und offen/zu ueberleben den Neustart.
  let sideW = $state(stored("term.side", 360));
  let side = $state(stored("term.side.open", 1) === 1);
  function toggleSide() {
    side = !side;
    try {
      localStorage.setItem("term.side.open", side ? "1" : "0");
    } catch {}
  }
  // Bild aus dem Terminal zeigt das Panel; dafuer muss es offen sein.
  $effect(() => {
    if (pasted.req && !side) untrack(toggleSide);
  });
  const running = $derived(new Set(sessions.filter((s) => !s.group).map((s) => s.repo.path)));
  // Git-Ansicht ueberdeckt Liste und Terminal; Terminals laufen darunter weiter.
  let gitRepo = $state<Repo | null>(null);
  let gitView = $state<GitView>();
  // Editor-Ansicht: wie Git nur gemountet, solange sie zu sehen ist; die Puffer liegen in $lib/editor.svelte.
  let editRepo = $state<Repo | null>(null);
  const view = $derived(editRepo ? "edit" : gitRepo ? "git" : active ? "term" : "list");
  const viewRepo = $derived(editRepo ?? gitRepo ?? activeSession?.repo);
  // Rust fragt vor dem Beenden nach, solange irgendwo ungespeicherte Aenderungen liegen.
  $effect(() => {
    editorDirty(isDirty()).catch(() => {});
  });
  let cloneOpen = $state(false);
  let createOpen = $state(false);
  let accountsOpen = $state(false);
  let accounts = $state<Account[]>([]);
  let skillStore = $state<SkillStore>({ profiles: {}, kindProfiles: {}, projects: {} });
  let profilesOpen = $state(false);
  let claudeOpen = $state(false);
  let claudeAccountsOpen = $state(false);
  // Haeufige Claude-Einstellungen direkt im Menue; der volle Dialog bleibt fuer den Rest.
  let claudeCfg = $state<ClaudeCfg | null>(null);
  const loadClaudeCfg = () => readClaude().then((c) => (claudeCfg = c), () => (claudeCfg = null));
  async function setClaudeCfg(key: string, value: unknown) {
    try {
      claudeCfg = await setClaude(key, value);
    } catch {
      loadClaudeCfg();
    }
  }
  // Sync-Fehler sichtbar in jeder Ansicht (Liste, Terminal, Git).
  let skillNotice = $state("");

  async function toggleAutostart() {
    try {
      await (autostart ? disable() : enable());
      autostart = await isEnabled();
    } catch (e) {
      notice = String(e);
    }
  }

  const lidNote = () =>
    mac
    ? "macOS fragt dafür einmal pro App-Start nach dem Admin-Passwort."
    : navigator.userAgent.includes("Windows")
      ? "Ändert solange die Deckel-Aktion des Energieplans. Auf Geräten mit Modern Standby unzuverlässig; danach schläft er erst nach der normalen Leerlaufzeit."
      : "Braucht systemd-logind; ob GNOME/KDE die Sperre beachten, ist nicht geprüft.";
  async function toggleLidAwake() {
    const msg =
      "Der Laptop bleibt zugeklappt wach, solange eine Claude-Session gerade arbeitet (Display aus). Wartet Claude auf dich oder ist fertig, schläft er normal ein. " +
      "In der Tasche kann er dabei heiß werden; unter 20 % Akku wird nicht wach gehalten.\n\n" +
      lidNote();
    if (!lidAwake && !(await confirm(msg, "Einschalten", "Wach bei zugeklapptem Laptop?"))) return;
    lidAwake = !lidAwake;
    await invoke("set_awake", { on: lidAwake });
    await store.set("lidAwake", lidAwake);
  }

  async function toggleTray() {
    tray = !tray;
    await invoke("set_tray", { on: tray });
    await store.set("tray", tray);
  }

  function saveAmongUs() {
    store.set("amongUs", $state.snapshot(amongUs));
  }

  async function togglePin(path: string) {
    pins = pins.includes(path) ? pins.filter((p) => p !== path) : [...pins, path];
    await store.set("pins", pins);
  }

  /** Repo-Pfad in Ordner + Name trennen. */
  function split(rel: string): [string, string] {
    const i = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\"));
    return i < 0 ? ["", rel] : [rel.slice(0, i), rel.slice(i + 1)];
  }

  const hits = $derived.by(() => {
    const q = query.trim();
    return repos
      .map((repo) => {
        const [dir, name] = split(repo.rel);
        // Name zaehlt doppelt: wer "backend" tippt, meint das Projekt, nicht den Ordner.
        const onName = fuzzy(name, q);
        const onPath = fuzzy(repo.rel, q);
        // "rust" oder "c#" tippen soll die passenden Projekte zeigen, aber nie vor Namenstreffern.
        const onLang = q.length > 1 ? fuzzy([repo.kind, ...(repo.langs ?? [])].filter(Boolean).join(" "), q) : null;
        if (!onName && !onPath && !onLang) return null;
        return {
          repo,
          dir,
          name,
          marks: onName?.hits ?? [],
          score: Math.max(
            (onName?.score ?? -99) * 2,
            onPath?.score ?? -99,
            (onLang?.score ?? -99) - 10,
          ),
        };
      })
      .filter((m) => m !== null)
      .sort((a, b) => (q ? b.score - a.score : a.repo.rel.localeCompare(b.repo.rel)));
  });

  /** Angepinntes zuerst, dann Laufendes, sonst nach Ordner gruppiert — bei Suche eine Liste nach Relevanz. */
  const groups = $derived.by(() => {
    // Laufende Sessions oben, sonst bleibt die Reihenfolge (sort ist stabil).
    const pinned = hits
      .filter((h) => pins.includes(h.repo.path))
      .sort((a, b) => +running.has(b.repo.path) - +running.has(a.repo.path));
    const live = hits.filter((h) => !pins.includes(h.repo.path) && running.has(h.repo.path));
    const rest = hits.filter((h) => !pins.includes(h.repo.path) && !running.has(h.repo.path));
    const head = [
      ...(pinned.length ? [{ heading: "Angepinnt", items: pinned }] : []),
      ...(live.length ? [{ heading: "Aktiv", items: live }] : []),
    ];

    if (query.trim()) return [...head, { heading: "", items: rest }];

    const by = new Map<string, typeof hits>();
    for (const h of rest) {
      // Einzelprojekte liegen ausserhalb des Dev-Ordners, ihr Pfad sagt dort nichts
      const top = extra.includes(h.repo.path) ? "Einzeln hinzugefügt" : h.dir.split(/[\\/]/)[0] || "Direkt im Ordner";
      (by.get(top) ?? by.set(top, []).get(top)!).push(h);
    }
    return [...head, ...[...by].map(([heading, items]) => ({ heading, items }))];
  });

  const flat = $derived(groups.flatMap((g) => g.items));
  // Gruppe markiert: kein Projekt, sonst wirkten Strg+P/G/E aufs erste Repo
  const current = $derived(selected.startsWith("group:") ? undefined : (flat.find((h) => h.repo.path === selected) ?? flat[0]));

  // Maximiert-Zustand fuers Icon; aendert sich auch per Doppelklick auf die Titelleiste oder Win+Pfeil.
  let maximized = $state(false);
  // macOS: native Ampeln im Overlay-Titelbalken (tauri.macos.conf.json) statt eigener Knoepfe.
  const mac = navigator.userAgent.includes("Mac");
  const mod = mac ? "⌘" : "Strg";
  // Im macOS-Vollbild sind die Ampeln weg, dann kein Platz dafuer freihalten.
  let fullscreen = $state(false);
  const lights = $derived(mac && !fullscreen);
  onMount(() => {
    const win = getCurrentWindow();
    const sync = async () => {
      maximized = await win.isMaximized();
      fullscreen = await win.isFullscreen();
    };
    sync();
    const off = win.onResized(sync);
    return () => off.then((f) => f());
  });

  // Zoom in Prozent ueber den nativen Webview-Zoom: skaliert alle Ansichten, Dialoge und die Vorschau gleich.
  let zoom = $state(100);
  function applyZoom(pct: number) {
    zoom = pct;
    getCurrentWebview().setZoom(pct / 100).catch(() => {});
  }
  function setZoom(dir: number) {
    applyZoom(zoomStep(zoom, dir));
    store?.set("zoom", zoom);
  }
  onMount(() => {
    // Flaechen mit eigenem Zoom (Bildansicht) bekommen ihre Ereignisse selbst.
    const own = (e: Event) => !!(e.target as Element | null)?.closest?.("[data-own-zoom]");
    // Mausrad-Raste = ein Schritt; Touchpad-Pinch (viele kleine Deltas) wird gesammelt, je 40 Einheiten ein
    // Schritt. Eine Zeitsperre liess beim durchgehenden Pinchen nur einen Schritt pro Geste durch.
    let acc = 0;
    let lastAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || (mac && e.metaKey)) || !e.deltaY || own(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(e.deltaY) >= 50) {
        acc = 0;
        return setZoom(-Math.sign(e.deltaY));
      }
      if (e.timeStamp - lastAt > 300) acc = 0;
      lastAt = e.timeStamp;
      acc += e.deltaY;
      while (Math.abs(acc) >= 40) {
        const d = Math.sign(acc);
        acc -= d * 40;
        setZoom(-d);
      }
    };
    // WebKit (macOS) meldet Pinch als GestureEvent mit kumulativem scale statt als Strg+Rad: je ~12 % ein
    // Schritt. preventDefault verhindert zudem das native Vergroessern der ganzen Seite.
    let base = 1;
    const onGesture = (e: Event) => {
      e.preventDefault();
      if (own(e)) return;
      const scale = (e as Event & { scale: number }).scale;
      if (e.type === "gesturestart") base = 1;
      else if (e.type === "gesturechange" && Math.abs(Math.log(scale / base)) >= 0.12) {
        setZoom(scale > base ? 1 : -1);
        base = scale;
      }
    };
    const gestures = ["gesturestart", "gesturechange"];
    // Nicht passiv, sonst wirkt preventDefault nicht; Capture, damit es auch ueber dem Terminal greift.
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    for (const t of gestures) window.addEventListener(t, onGesture, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      for (const t of gestures) window.removeEventListener(t, onGesture);
    };
  });

  // Links nie in der App-Webview oder einem neuen App-Fenster oeffnen (zeigte sonst 404 vom Dev-Server bzw.
  // ein leeres Fenster): http(s) im System-Browser, alles andere (relativ, file:, javascript:) verwerfen.
  onMount(() => {
    const external = (href: string) => {
      try {
        const u = new URL(href, location.href);
        if (u.origin !== location.origin && (u.protocol === "https:" || u.protocol === "http:")) forge.openUrl(u.href).catch(() => {});
      } catch {}
    };
    const open = window.open;
    window.open = (url) => (url && external(String(url)), null);
    // Bubble-Phase: Markdown.svelte u. a. erledigen ihre Links selbst (defaultPrevented).
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a || e.defaultPrevented) return;
      e.preventDefault();
      external(a.getAttribute("href")!);
    };
    // Natives Kontextmenue auf Links ("In neuem Fenster oeffnen") wuerde ein App-Fenster aufmachen.
    const onMenu = (e: MouseEvent) => (e.target as Element | null)?.closest?.("a[href]") && e.preventDefault();
    window.addEventListener("click", onClick);
    window.addEventListener("auxclick", onClick);
    window.addEventListener("contextmenu", onMenu);
    return () => {
      window.open = open;
      window.removeEventListener("click", onClick);
      window.removeEventListener("auxclick", onClick);
      window.removeEventListener("contextmenu", onMenu);
    };
  });

  // Neue Version aus GitHub-Releases, beim Start und alle 4 h; Fehler (offline, Dev-Build) still ignorieren.
  let update = $state<Update | null>(null);
  let updating = $state(false);
  let checking = $state(false);
  async function checkUpdate(manual = false) {
    if (updating || checking) return;
    checking = true;
    try {
      update = (await check()) ?? update;
      if (manual && !update) okNotice = "L'Atelier ist aktuell.";
    } catch (e) {
      if (manual) notice = `Update-Prüfung fehlgeschlagen: ${e}`;
    } finally {
      checking = false;
    }
  }
  onMount(() => {
    checkUpdate();
    const id = setInterval(checkUpdate, 4 * 60 * 60 * 1000);
    return () => clearInterval(id);
  });

  // Fehlende Voraussetzungen (claude, unter Windows Git): Knopf in der Titelleiste installiert sie.
  const DEPS: Record<string, string> = { claude: "Claude Code", git: "Git" };
  let missing = $state<string[]>([]);
  let installingDeps = $state(false);
  onMount(async () => {
    missing = await invoke<string[]>("deps_missing").catch(() => []);
  });
  async function installDeps() {
    installingDeps = true;
    for (const name of missing) {
      try {
        okNotice = (await invoke<string>("deps_install", { name })) || `${DEPS[name]} installiert.`;
      } catch (e) {
        notice = String(e);
        break;
      }
    }
    missing = await invoke<string[]>("deps_missing").catch(() => missing);
    installingDeps = false;
  }

  const sessionsLost = () => `${sessions.length} laufende Claude-Sitzung(en) werden dabei beendet.`;

  /** Ohne Tray beendet Schliessen die App (lib.rs, on_window_event); Rust fragt nur nach ungespeicherten Dateien. */
  async function closeWindow() {
    if (!mac && !tray && sessions.length && !(await confirm(sessionsLost(), "Beenden", "L'Atelier de Claude beenden?"))) return;
    getCurrentWindow().close();
  }

  async function installUpdate() {
    // Der Neustart laeuft an der Rueckfrage in Rust vorbei.
    if (isDirty() && !(await confirm("Ungespeicherte Änderungen im Editor verwerfen und neu starten?", "Neu starten"))) return;
    if (sessions.length && !(await confirm(sessionsLost(), "Neu starten"))) return;
    updating = true;
    try {
      await update!.downloadAndInstall();
      await relaunch();
    } catch (e) {
      notice = String(e);
      updating = false;
    }
  }

  onMount(async () => {
    store = await load("settings.json", { autoSave: true });
    // Vor allem anderen, damit auch der Erststart-Dialog gezoomt ist.
    applyZoom(clampZoom(await store.get("zoom")));
    const saved = await store.get<string>("root");
    root = saved ?? (await invoke<string>("default_root"));
    extra = (await store.get<string[]>("extra")) ?? [];
    home = await homeDir();
    pins = (await store.get<string[]>("pins")) ?? [];
    repoGroups = (await store.get<RepoGroup[]>("repoGroups")) ?? [];
    accounts = (await store.get<Account[]>("accounts")) ?? [];
    autostart = await isEnabled().catch(() => false);
    tray = (await store.get<boolean>("tray")) ?? true;
    lidAwake = (await store.get<boolean>("lidAwake")) ?? false;
    // Meldung vom Aufraeumen nach einem Absturz kam vor diesem Listener: hier abholen.
    const awakeErr = await invoke<string | null>("set_awake", { on: lidAwake });
    if (awakeErr) notice = awakeErr;
    amongUs = { ...amongUs, ...(await store.get<typeof amongUs>("amongUs")) };
    skillStore = {
      profiles: (await store.get<SkillStore["profiles"]>("skillProfiles")) ?? {},
      kindProfiles: (await store.get<SkillStore["kindProfiles"]>("kindProfiles")) ?? {},
      projects: (await store.get<SkillStore["projects"]>("projectSkills")) ?? {},
    };
    await invoke("set_tray", { on: tray });

    // Erster Start: Dev-Ordner erst bestaetigen lassen, dann einlesen.
    if (saved == null) {
      setup = true;
      scanning = false;
      return;
    }

    // Zuerst den letzten Stand zeigen, dann im Hintergrund frisch einlesen.
    const cached = await store.get<Cache>("cache");
    if (cached?.root === root && cached.repos.length) {
      repos = cached.repos;
      scannedAt = cached.at;
      fromCache = true;
      scanning = false;
    }
    await rescan();
  });

  // Nur der zuletzt gestartete Scan zaehlt, sonst ueberschreibt ein alter Ordner den neuen.
  let scanGen = 0;

  async function rescan() {
    const g = ++scanGen;
    const r = root;
    scanning = true;
    error = "";
    try {
      const found = await invoke<Repo[]>("scan", { root: r, extra });
      if (g !== scanGen) return;
      repos = found;
      scannedAt = Date.now();
      fromCache = false;
      await store.set("cache", { root: r, repos, at: scannedAt } satisfies Cache);
    } catch (e) {
      if (g !== scanGen) return;
      repos = [];
      error = String(e);
    }
    scanning = false;
    input?.focus();
  }

  let setup = $state(false);
  let rootOpen = $state(false);

  async function chooseRoot(r: string) {
    root = r;
    await store.set("root", root);
    setup = rootOpen = false;
    repos = [];
    await rescan();
  }


  const pickRoot = () => (rootOpen = true);

  /** Claude ohne Projekt: laeuft im Home-Ordner, ohne Git. */
  async function launchFree() {
    const path = await homeDir();
    launch({ path, rel: "~", branch: "", last_commit: "", langs: [] });
  }
  const isFree = (repo?: Repo) => repo?.rel === "~" && !repo.branch;

  // ---------- Skills ----------

  async function saveSkills() {
    const s = $state.snapshot(skillStore);
    await Promise.all([
      store.set("skillProfiles", s.profiles),
      store.set("kindProfiles", s.kindProfiles),
      store.set("projectSkills", s.projects),
    ]);
  }

  // Pro Projekt nacheinander, jeweils mit dem Stand beim Start: sonst ueberholt ein alter Sync einen neuen.
  const syncQueue = new Map<string, Promise<unknown>>();

  /** Ergebnis in settings.local.json der Projekte schreiben; Fehler nur melden. */
  async function syncSkills(paths: string[]) {
    const run = (p: string) => {
      const next = (syncQueue.get(pkey(p)) ?? Promise.resolve())
        .then(() => sync($state.snapshot(skillStore), p, repos.find((r) => r.path === p)?.kind))
        .then(() => "", (e) => `${p}: ${e}`);
      syncQueue.set(pkey(p), next);
      return next;
    };
    const errs = await Promise.all(paths.map(run));
    const msg = errs.filter(Boolean).join("\n");
    if (msg) skillNotice = `Skills nicht geschrieben: ${msg}`;
  }

  async function setProjectSkills(path: string, ps: ProjectSkills) {
    skillStore.projects[pkey(path)] = ps;
    await saveSkills();
    await syncSkills([path]);
  }

  async function saveProfiles(next: SkillStore) {
    const paths = touched($state.snapshot(skillStore), next, repos);
    // Betroffene gelten ab jetzt als verwaltet, sonst bleibt nach Entfernen des Profils der alte Stand liegen.
    for (const p of paths) next.projects[pkey(p)] ??= emptyProject();
    skillStore = next;
    await saveSkills();
    await syncSkills(paths);
  }

  const profileName = (repo: Repo) => profileFor(skillStore.projects[pkey(repo.path)], repo.kind, skillStore.kindProfiles);

  // Tab-Status nachziehen; Rueckfrage oder fertig bei Fenster im Hintergrund: Dock-Icon huepft, Badge zaehlt Hinweise.
  onMount(() => {
    const win = getCurrentWindow();
    let badge = 0;
    // Ein langsamer Durchlauf (viele Sitzungen) darf sich nicht mit dem naechsten ueberlappen.
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await poll();
      } finally {
        busy = false;
      }
    };
    const poll = async () => {
      const focused = document.hasFocus();
      let alert = false;
      for (const s of sessions) {
        const p = await invoke<{ busy?: boolean; waiting?: boolean } | null>("claude_panel", { id: s.id }).catch(() => null);
        if (!sessions.includes(s)) continue;
        const prev = tabs[s.id];
        const next = tabState(prev, p, focused && view === "term" && s.id === active);
        if (next === prev) continue;
        tabs[s.id] = next;
        alert ||= next === "ask" || next === "done";
      }
      if (alert && !focused) win.requestUserAttention(UserAttentionType.Informational).catch(() => {});
      const n = sessions.filter((s) => tabs[s.id] === "ask" || tabs[s.id] === "done").length;
      if (n !== badge) win.setBadgeCount((badge = n) || undefined).catch(() => {});
    };
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  });

  /** Offene Session des Projekts zeigen, sonst eine neue starten. */
  async function launch(repo?: Repo) {
    if (!repo) return;
    if (gitRepo && gitView && !(await gitView.canLeave())) return;
    // Vor dem Start schreiben, damit claude die Skills schon sieht; ein Fehler haelt den Start nicht auf.
    // Nie konfigurierte Projekte bleiben unberuehrt.
    if (!isFree(repo) && !running.has(repo.path) && managed(skillStore, repo.path, repo.kind)) await syncSkills([repo.path]);
    leaveGit();
    editRepo = null;
    let s = sessions.find((s) => !s.group && s.repo.path === repo.path);
    // Eindeutig pro Seitenladung: nach einem Neuladen laufen alte PTYs evtl. noch unter "t1"
    if (!s) sessions.push((s = { id: crypto.randomUUID(), repo }));
    active = s.id;
  }

  /** Repo-Gruppe: eine Sitzung im Haupt-Repo, die anderen Repos als weitere Arbeitsordner. Offene zeigen. */
  async function launchGroup(g: RepoGroup) {
    const [main, ...rest] = g.paths.map((p) => repos.find((r) => r.path === p)).filter((r) => r !== undefined);
    // Nicht still ein anderes Repo zum Haupt-Repo machen: claude startete sonst im falschen Ordner
    if (main?.path !== g.paths[0]) return void (notice = `Gruppe „${g.name}“: Haupt-Repo nicht gefunden (${g.paths[0]}).`);
    if (gitRepo && gitView && !(await gitView.canLeave())) return;
    leaveGit();
    editRepo = null;
    let s = sessions.find((s) => s.group === g.name);
    if (!s) sessions.push((s = { id: crypto.randomUUID(), repo: main, group: g.name, dirs: rest.map((r) => r.path) }));
    active = s.id;
  }

  async function saveGroup(orig: string | null, g: RepoGroup) {
    repoGroups = orig === null ? [...repoGroups, g] : repoGroups.map((x) => (x.name === orig ? g : x));
    // Laufende Sitzung behaelt ihre Ordner bis zum Neustart, nur der Name zieht mit
    for (const s of sessions) if (orig !== null && s.group === orig) s.group = g.name;
    groupEdit = null;
    await store.set("repoGroups", $state.snapshot(repoGroups));
  }

  async function deleteGroup(name: string) {
    if (!(await confirm(`Gruppe „${name}“ löschen? Die Repos selbst bleiben unverändert.`, "Löschen"))) return;
    repoGroups = repoGroups.filter((g) => g.name !== name);
    await store.set("repoGroups", $state.snapshot(repoGroups));
  }

  /** Git-Ansicht schliessen; der Branch kann sich dort geaendert haben, Liste und Titel nachziehen. */
  function leaveGit() {
    const r = gitRepo;
    gitRepo = null;
    if (r)
      git.status(r.path).then(
        (st) => (r.branch = st.branch ?? st.head.slice(0, 7)),
        () => {},
      );
  }

  /** Git-Ansicht fuer das Projekt; ein laufendes Terminal bleibt im Hintergrund. */
  function openGit(repo?: Repo) {
    if (!repo) return;
    active = null;
    editRepo = null;
    gitRepo = repo;
  }

  /** Tab-Klick: gleiche Ansicht fuer das Projekt; ohne Repo (freie Session) zu Claude. */
  async function openTab(repo: Repo) {
    if (view === "term" || isFree(repo)) return launch(repo);
    if (view === "edit") return openEdit(repo);
    if (gitView && !(await gitView.canLeave())) return;
    leaveGit();
    openGit(repo);
  }

  /** Tab einer Gruppen-Sitzung: wie launchGroup, ohne die Gruppe neu aufzuloesen. */
  async function openGroupTab(id: string) {
    if (gitRepo && gitView && !(await gitView.canLeave())) return;
    leaveGit();
    editRepo = null;
    active = id;
  }

  /** Editor-Ansicht fuer das Projekt; Terminal laeuft weiter, ungespeicherte Puffer bleiben beim Wechsel erhalten. */
  async function openEdit(repo?: Repo) {
    if (!repo || isFree(repo)) return;
    if (gitRepo && gitView && !(await gitView.canLeave())) return;
    leaveGit();
    active = null;
    editRepo = repo;
  }

  // Wach-Halt nicht moeglich (Passwort abgebrochen, Richtlinie, kein logind): Rust hat ihn schon abgeschaltet.
  onMount(() => {
    const off = listen<string>("awake-error", (e) => {
      lidAwake = false;
      store?.set("lidAwake", false);
      notice = e.payload;
    });
    return () => void off.then((f) => f());
  });

  // Claude (Tool open_file) zeigt eine Datei: Editor des Projekts oeffnen.
  onMount(() => {
    const off = listenIde(async (path, file, line) => {
      const repo = sessions.find((s) => s.repo.path === path)?.repo ?? repos.find((r) => r.path === path);
      if (!repo) return;
      await openEdit(repo);
      if (editRepo === repo) await openFile(repo.path, file, line);
    });
    return () => void off.then((f) => f());
  });

  /** Nach Klonen/Hinzufuegen neu einlesen und das Projekt markieren. Liegt es nicht im Dev-Ordner,
   *  merkt es sich die Liste als Einzelprojekt. */
  async function cloned(path: string) {
    await rescan();
    const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
    let hit = repos.find((r) => norm(r.path) === norm(path));
    if (!hit) {
      extra = [...extra, path];
      await store.set("extra", extra);
      await rescan();
      hit = repos.find((r) => norm(r.path) === norm(path));
    }
    if (hit) {
      query = "";
      // Der Suchwechsel waehlt per afterTick (Microtasks) den ersten Eintrag, daher danach setzen.
      await new Promise((r) => setTimeout(r));
      selected = hit.path;
    }
  }

  async function addProject() {
    const picked = await open({ directory: true, defaultPath: root || home });
    if (typeof picked === "string") await cloned(picked);
  }

  /** Einzelprojekt nur aus der Liste nehmen, der Ordner bleibt. */
  async function unlist(path: string) {
    extra = extra.filter((p) => p !== path);
    await store.set("extra", extra);
    repos = repos.filter((r) => r.path !== path);
    if (pins.includes(path)) await togglePin(path);
  }

  async function reveal(repo?: Repo) {
    if (!repo) return;
    try {
      await invoke("reveal", { path: repo.path });
    } catch (e) {
      notice = String(e);
    }
  }

  // Fehler ausserhalb des Scans als Leiste, error wuerde die ganze Liste ersetzen.
  let notice = $state("");
  let okNotice = $state("");

  // ---------- Unity ----------

  // unity_info je Repo nur bei Bedarf holen (nicht beim Scan fuer alle): lazy beim Sichtbarwerden in der Liste.
  let unityInfo = $state<Record<string, UnityInfo>>({});
  const unityInfoLoading = new Set<string>();

  async function loadUnityInfo(path: string, force = false) {
    if (!force && (unityInfo[path] || unityInfoLoading.has(path))) return;
    unityInfoLoading.add(path);
    try {
      unityInfo[path] = await unity.info(path);
    } catch {
      // Badge zeigt dann einfach nur "Unity" ohne Status weiter an.
    }
    unityInfoLoading.delete(path);
  }

  /** Feuert `cb` einmalig, wenn das Element in den Sichtbereich der Liste scrollt. */
  function onVisible(node: Element, cb: () => void) {
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        cb();
        io.disconnect();
      }
    });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  async function openUnityEditor(repo: Repo) {
    try {
      // Kehrt erst zurueck, wenn der Editor laeuft (bis 180 s).
      await unity.open(repo.path);
    } catch (e) {
      notice = String(e);
    }
    await loadUnityInfo(repo.path, true);
  }

  let unityClosePath = $state<string | null>(null);

  async function setupUnity(repo: Repo) {
    try {
      const log = await unity.setup(repo.path);
      okNotice = log.trim().split("\n").slice(-2).join(" · ") || "Unity-Support eingerichtet.";
    } catch (e) {
      notice = String(e);
    }
    await loadUnityInfo(repo.path, true);
  }

  async function browse(repo: Repo) {
    try {
      const remotes = await git.remotes(repo.path);
      const r = remotes.find((r) => r.name === "origin") ?? remotes[0];
      const url = r && (await forge.webUrl(r.url));
      if (!url) throw "Kein Remote mit Web-Adresse.";
      await forge.openUrl(url);
    } catch (e) {
      notice = String(e);
    }
  }

  // Loeschen: vorher zeigen, was nur auf diesem Rechner liegt.
  let doomed = $state<{ repo: Repo; risks: string[] } | null>(null);
  let trashing = $state(false);

  async function askTrash(repo: Repo) {
    const risks: string[] = [];
    try {
      const [st, branches, stashes, remotes] = await Promise.all([
        git.status(repo.path),
        git.branches(repo.path),
        git.stashes(repo.path),
        git.remotes(repo.path),
      ]);
      const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
      if (!remotes.length) risks.push("Kein Remote: alles liegt nur hier.");
      if (st.files.length) risks.push(n(st.files.length, "nicht committete Änderung", "nicht committete Änderungen"));
      // Nie gepushte Branches zaehlen nur, wenn sie nicht schon in der Basis stecken.
      const unpushed = branches.filter((b) => !b.remote && (b.ahead > 0 || (!b.upstream && b.unmerged !== 0)));
      if (remotes.length && unpushed.length)
        risks.push(`Nicht gepusht: ${unpushed.map((b) => b.name + (b.ahead ? ` (+${b.ahead})` : "")).join(", ")}`);
      if (stashes.length) risks.push(n(stashes.length, "Stash", "Stashes"));
    } catch (e) {
      risks.push(`Status unbekannt: ${e}`);
    }
    doomed = { repo, risks };
  }

  async function trashRepo() {
    if (!doomed) return;
    const { repo } = doomed;
    trashing = true;
    try {
      // Erst pruefen, ob geloescht werden darf: sonst stuerben die Prozesse unten umsonst.
      await invoke("trash_check", { path: repo.path, root });
      // Laufende Sitzung, Run-Prozess, Testlauf und Language-Server zuerst beenden, unter Windows sperrt ihr cwd sonst den Ordner.
      for (const s of sessions) if (s.repo.path === repo.path) forget(s.id);
      sessions = sessions.filter((s) => s.repo.path !== repo.path);
      await tick();
      await runStop(repo.path);
      await testCancel(repo.path);
      await stopLsp(repo.path);
      await invoke("trash_repo", { path: repo.path, root });
      // Der Dialog hat das Loeschen schon bestaetigt: Puffer des Projekts ohne zweite Frage verwerfen.
      drop(repo.path, true);
      repos = repos.filter((r) => r.path !== repo.path);
      if (pins.includes(repo.path)) await togglePin(repo.path);
      await store.set("cache", { root, repos, at: scannedAt } satisfies Cache);
      doomed = null;
    } catch (e) {
      notice = String(e);
      doomed = null;
    }
    trashing = false;
  }

  async function back() {
    if (gitRepo && gitView && !(await gitView.canLeave())) return;
    // Zurueck zur Liste schliesst den Editor des Projekts: bei ungespeicherten Aenderungen fragt drop nach.
    if (editRepo && !(await drop(editRepo.path))) return;
    // Aus Terminal oder Git heraus bleibt der Editor-Zustand, aber kein Prozess ohne sichtbaren Stopp-Knopf.
    if (viewRepo) void runStop(viewRepo.path);
    editRepo = null;
    active = null;
    leaveGit();
    await tick();
    input?.focus();
  }

  /** Per Klick beenden: claude arbeitet evtl. noch, daher nachfragen. */
  async function endSession(id: string) {
    if (await confirm("Sitzung beenden? Ein laufender claude-Prozess wird abgebrochen.", "Beenden")) closeSession(id);
  }

  const forget = (id: string) => (delete tabs[id], delete modes[id]);

  /** Aus der Liste nehmen; der Terminal-Unmount schliesst die PTY. */
  function closeSession(id: string) {
    forget(id);
    sessions = sessions.filter((s) => s.id !== id);
    // Wie bei Tabs ueblich zur letzten verbliebenen Session, erst ohne Session zurueck zur Liste.
    if (active === id) sessions.length ? (active = sessions.at(-1)!.id) : back();
  }

  // Klick/Enter oeffnet Git, mit Strg+Enter bzw. Umschalt+Klick Claude (Strg+Klick ist auf dem Mac Rechtsklick).
  // onSelect der Liste kennt kein Event, daher die Taste in der Capture-Phase merken, bevor die Liste reagiert.
  let withClaude = false;
  // Esc gehoert offenen Dialogen/Menues. Die schliessen schon vor onKey, daher hier vorher nachsehen.
  let overlayOnEsc = false;
  const noteCtrl = (e: KeyboardEvent | PointerEvent) => {
    withClaude = e instanceof KeyboardEvent ? e.ctrlKey || e.metaKey : e.shiftKey;
    if (!(e instanceof KeyboardEvent)) return;
    // Capture am Fenster: vor xterm und CodeMirror, die Shell bekommt die Taste nicht.
    const dir = zoomKey(e, mac);
    if (dir !== null) {
      e.preventDefault();
      e.stopPropagation();
      setZoom(dir);
      return;
    }
    if (e.key === "Escape")
      overlayOnEsc = !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
    // WebView2 wuerde neu laden: Sitzungen verwaisen. Im Terminal gehoert Strg+R/F5 der Shell (xterm verhindert selbst).
    const reload = e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r");
    if (reload && !(e.target instanceof Element && e.target.closest(".xterm"))) e.preventDefault();
  };

  // Alle Dialoge ausser der Hilfe (F1 schaltet sie um)
  const anyDialog = $derived(
    cloneOpen || createOpen || accountsOpen || claudeOpen || setup || rootOpen || !!doomed || profilesOpen || !!groupEdit ||
      claudeAccountsOpen || !!confirming.q || !!unityClosePath || ide.diffs.length > 0,
  );

  function onKey(e: KeyboardEvent) {
    // Im Terminal gehoeren fast alle Kuerzel der Shell (Readline: Strg+R/K/E/P/O/G ...).
    // Die Git-Ansicht hat ihre eigenen Kuerzel in GitView.svelte.
    // Der Editor hat Strg+S/Esc selbst (EditorView, CodeMirror); Esc verlaesst ihn nicht.
    if (view !== "list") {
      // Mit Umschalt: Strg+E gehoert im Terminal der Shell.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        openEdit(viewRepo);
      } else if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "w") || (e.shiftKey && e.key === "Escape")) {
        e.preventDefault();
        back();
      } else if (e.key === "Escape" && view === "git") {
        // Offene Dialoge/Menues schliessen sich selbst, Eingabefelder verlieren nur den Fokus.
        const el = document.activeElement;
        if (overlayOnEsc) return;
        e.preventDefault();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();
        else back();
      } else if (altKey(e, "e")) {
        e.preventDefault();
        reveal(viewRepo);
      } else if (altKey(e, "g") && view !== "git" && !isFree(viewRepo)) {
        e.preventDefault();
        openGit(viewRepo);
      }
      return;
    }
    // Esc hat schon ein Dialog oder Menue geschlossen, nicht auch noch das Fenster.
    if (e.key === "Escape" && (overlayOnEsc || e.defaultPrevented)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === "F1" || (ctrl && e.key === "/")) {
      if (!anyDialog) help = !help;
      e.preventDefault();
      return;
    }
    // Offene Dialoge bekommen ihre Tasten selbst.
    if (help || anyDialog) return;

    if (ctrl && e.key >= "1" && e.key <= "9") {
      launch(flat[Number(e.key) - 1]?.repo);
    } else if (ctrl && e.key.toLowerCase() === "k") {
      input?.select();
    } else if (ctrl && e.key.toLowerCase() === "r") {
      rescan();
    } else if (ctrl && e.key.toLowerCase() === "o") {
      pickRoot();
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "e") {
      openEdit(current?.repo);
    } else if (ctrl && e.key.toLowerCase() === "e") {
      reveal(current?.repo);
    } else if (ctrl && e.key.toLowerCase() === "p") {
      if (current) togglePin(current.repo.path);
    } else if (ctrl && e.key.toLowerCase() === "g") {
      openGit(current?.repo);
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") {
      createOpen = true;
    } else if (ctrl && e.key.toLowerCase() === "n") {
      cloneOpen = true;
    } else if (ctrl && e.key.toLowerCase() === "t") {
      launchFree();
    } else if (e.key === "Escape") {
      if (query) query = "";
      else closeWindow();
    } else {
      return;
    }
    e.preventDefault();
  }

  const short = $derived(root ? root.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, "~") : "Kein Dev-Ordner");
</script>

<svelte:window onkeydown={onKey} onkeydowncapture={noteCtrl} onpointerdowncapture={noteCtrl} />

{#if amongUs.on}<IdleAmongUs rate={amongUs.rate} volume={amongUs.volume} />{/if}

<div
  class="bg-chrome border-border flex h-9 items-center border-b {lights ? '' : 'pl-3.5'}"
  style:padding-left={lights ? `${8000 / zoom}px` : undefined}
  data-tauri-drag-region
>
  {#if viewRepo}
    <button
      class="text-muted-foreground hover:bg-secondary hover:text-foreground {lights ? '' : '-ml-3.5'} mr-1 grid h-9 w-10 place-items-center"
      onclick={back}
      aria-label="Zurück zur Liste ({mod}+Umschalt+W)"
      title="Zurück zur Liste ({mod}+Umschalt+W)"><ArrowLeftIcon class="size-3.5" /></button
    >
    <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" title={viewRepo.path} data-tauri-drag-region>
      <span class="truncate text-xs font-semibold" data-tauri-drag-region>
        {split(viewRepo.rel)[1]}
      </span>
      {#if split(viewRepo.rel)[0]}
        <span
          class="text-muted-foreground hidden truncate font-mono text-[11px] sm:block"
          data-tauri-drag-region
        >
          {split(viewRepo.rel)[0]}
        </span>
      {/if}
      {#if view === "term" && viewRepo.branch}
        <Badge variant="outline" class="text-muted-foreground shrink-0 gap-1 font-mono text-[11px]">
          <GitBranchIcon class="size-3" />
          {viewRepo.branch}
        </Badge>
      {/if}
      {#each tags(viewRepo) as lang (lang)}
        <Badge variant="outline" class="text-muted-foreground shrink-0 gap-1.5 text-[11px]">
          <span
            class="size-2 rounded-full"
            style="background:{LANG_COLOR[lang] ?? 'var(--muted-foreground)'}"
          ></span>
          {lang}
        </Badge>
      {/each}
    </div>
    {#if view === "git" && gitRepo}
      <Button
        variant="ghost"
        size="sm"
        class="text-muted-foreground h-6 gap-1.5 text-[11px]"
        onclick={() => reveal(gitRepo!)}
        title="Ordner im Explorer öffnen (Alt+E)"><FolderOpenIcon class="size-3.5" /> Explorer</Button
      >
      <Button
        variant="ghost"
        size="sm"
        class="text-muted-foreground h-6 text-[11px]"
        onclick={() => gitView?.reload()}
        title="Aktualisieren (F5)"
        aria-label="Aktualisieren"><RefreshIcon class="size-3.5" /></Button
      >
    {:else if view === "term" && activeSession}
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1.5 text-[11px] {side ? 'text-foreground' : 'text-muted-foreground'}"
        aria-pressed={side}
        onclick={toggleSide}
        title="Session, Workflows und Bilder"><WorkflowIcon class="size-3.5" /> Aktivität</Button
      >
      <Button
        variant="ghost"
        size="sm"
        class="text-muted-foreground h-6 text-[11px]"
        onclick={() => endSession(activeSession.id)}>Sitzung beenden</Button
      >
    {/if}
    <div class="bg-border mx-1 h-4 w-px"></div>
    <!-- Feste Reihenfolge in jeder Ansicht, damit beim Wechseln nichts springt; die wechselnden Extras stehen links davon. -->
    {@render viewButton("term", "Claude im Projekt öffnen", () => launch(viewRepo), TerminalIcon, "Claude")}
    {#if !isFree(viewRepo)}{@render viewButton("edit", `Editor (${mod}+Umschalt+E)`, () => openEdit(viewRepo), FileCodeIcon, "Editor")}{/if}
    {@render viewButton("git", "Git-Ansicht (Alt+G)", () => openGit(viewRepo), GitBranchIcon, "Git")}
  {:else}
    <img
      src="/logo.png"
      alt=""
      class="mr-2 size-4 [image-rendering:pixelated]"
      data-tauri-drag-region
    />
    <span class="text-muted-foreground flex-1 text-xs font-semibold" data-tauri-drag-region>
      L'Atelier de Claude
    </span>
  {/if}
  {#if update}
    <Button
      variant="ghost"
      size="sm"
      class="text-primary mr-1 h-6 gap-1.5 text-[11px]"
      disabled={updating}
      onclick={installUpdate}
      title={`Update installieren und neu starten${update.body ? `\n\n${update.body}` : ""}`}
      ><DownloadIcon class="size-3.5" /> {updating ? "Aktualisiere…" : `Update ${update.version}`}</Button
    >
  {/if}
  {#if missing.length}
    <Button
      variant="ghost"
      size="sm"
      class="mr-1 h-6 gap-1.5 text-[11px] text-warning"
      disabled={installingDeps}
      onclick={installDeps}
      title={`Fehlt auf diesem Rechner: ${missing.map((n) => DEPS[n]).join(", ")}. Klick installiert.`}
      ><DownloadIcon class="size-3.5" />
      {installingDeps ? "Installiere…" : `${missing.map((n) => DEPS[n]).join(" + ")} installieren`}</Button
    >
  {/if}
  {#if !mac}
    <!-- Fensterknoepfe wie bei Windows: nicht per Tab erreichbar, kein Fokusrahmen, Fokus bleibt im Terminal/der Suche. -->
    <button
      tabindex="-1"
      onmousedown={(e) => e.preventDefault()}
      class="text-muted-foreground hover:bg-secondary hover:text-foreground grid h-9 w-11 shrink-0 place-items-center outline-none"
      onclick={() => getCurrentWindow().minimize()}
      aria-label="Minimieren"><MinusIcon class="size-3.5" /></button
    >
    <button
      tabindex="-1"
      onmousedown={(e) => e.preventDefault()}
      class="text-muted-foreground hover:bg-secondary hover:text-foreground grid h-9 w-11 shrink-0 place-items-center outline-none"
      onclick={() => getCurrentWindow().toggleMaximize()}
      aria-label={maximized ? "Wiederherstellen" : "Maximieren"}
    >
      {#if maximized}
        <!-- Wiederherstellen: vorderes Quadrat unten links, hinteres oben rechts -->
        <svg class="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="0.5" y="2.5" width="9" height="9" rx="1" />
          <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1" />
        </svg>
      {:else}
        <SquareIcon class="size-3" />
      {/if}
    </button>
    <button
      tabindex="-1"
      onmousedown={(e) => e.preventDefault()}
      class="text-muted-foreground grid h-9 w-11 shrink-0 place-items-center outline-none hover:bg-[#b4404a] hover:text-white"
      onclick={closeWindow}
      aria-label="Schließen"><XIcon class="size-3.5" /></button
    >
  {/if}
</div>

<div class="flex h-[calc(100vh-2.25rem)] flex-col">
  <Notice bind:text={skillNotice} />
  <!-- Ueber allen Ansichten: Fehler aus Update, Wach-Halt oder Alt+E kommen auch aus Terminal und Git -->
  <Notice bind:text={notice} />
  {#if !notice}<Notice bind:text={okNotice} kind="ok" />{/if}
  <Command.Root
    shouldFilter={false}
    bind:value={selected}
    loop
    class="bg-background flex-1 rounded-none! p-0 {view !== 'list' ? 'hidden!' : ''}"
  >
    <div class="border-border flex items-center gap-2 border-b pr-2">
      <div class="flex-1 [&_[data-slot=command-input-wrapper]]:p-0">
        <Command.Input
          bind:ref={input}
          bind:value={query}
          placeholder="Projekt suchen"
          autofocus
          class="h-12! text-base!"
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        onclick={pickRoot}
        title={root ? `Dev-Ordner wechseln (Strg+O): ${root}` : "Dev-Ordner wählen (Strg+O)"}
        class="text-muted-foreground font-mono text-xs"
      >
        <FolderIcon class="size-3.5" />
        <span class="max-w-44 truncate">{short}</span>
      </Button>
      <!-- Aktionen als Icons: dort, wo man ohnehin arbeitet, statt in der Fusszeile -->
      <div class="text-muted-foreground flex items-center">
        <Button variant="ghost" size="icon" onclick={rescan} title="Neu einlesen (Strg+R)" aria-label="Neu einlesen">
          <RefreshIcon class="size-4 {scanning ? 'animate-spin' : ''}" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class={sessions.some((s) => isFree(s.repo)) ? "text-primary" : ""}
          onclick={launchFree}
          title="Claude ohne Projekt starten (Strg+T)"
          aria-label="Claude ohne Projekt starten"
        >
          <TerminalIcon class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onclick={addProject} title="Projektordner hinzufügen" aria-label="Projektordner hinzufügen">
          <FolderInputIcon class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onclick={() => (createOpen = true)} title="Neues Repo (Strg+Shift+N)" aria-label="Neues Repo">
          <FolderPlusIcon class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onclick={() => (cloneOpen = true)} title="Repo klonen (Strg+N)" aria-label="Repo klonen">
          <FolderDownIcon class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="relative"
          onclick={() => (accountsOpen = true)}
          title="Git-Konten (GitHub, GitLab)"
          aria-label="Git-Konten"
        >
          <KeyRoundIcon class="size-4" />
          {#if accounts.length}
            <span class="bg-primary absolute top-1.5 right-1.5 size-1.5 rounded-full"></span>
          {/if}
        </Button>
        <DropdownMenu.Root onOpenChange={(o) => o && loadClaudeCfg()}>
          <DropdownMenu.Trigger
            class="hover:bg-accent hover:text-foreground grid size-9 place-items-center rounded-md"
            title="Einstellungen"
            aria-label="Einstellungen"><SettingsIcon class="size-4" /></DropdownMenu.Trigger
          >
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              class={cn(menuContent, "min-w-56 rounded-lg shadow-lg")}
            >
              <!-- macOS: Autostart ueber die Systemeinstellungen. -->
              {#if !mac}
                {@render setting("Autostart", autostart, toggleAutostart, PowerIcon)}
              {/if}
              {@render setting(mac ? "Schließen legt in die Menüleiste" : "Schließen legt ins Tray", tray, toggleTray, InboxIcon)}
              {@render setting("Zugeklappt wach, solange Claude arbeitet", lidAwake, toggleLidAwake, LaptopIcon)}
              <DropdownMenu.Separator class={menuSeparator} />
              <div class="flex items-center gap-2 px-2 py-1.5">
                <ZoomInIcon class="text-muted-foreground size-3.5" />
                <span class="flex-1">Zoom</span>
                <div class="bg-secondary flex items-center rounded p-0.5">
                  <button
                    class="text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 disabled:opacity-40"
                    disabled={zoom <= ZOOM_MIN}
                    onclick={() => setZoom(-1)}
                    aria-label="Verkleinern"
                    title="Verkleinern ({mac ? '⌘' : 'Strg'} −)">−</button
                  >
                  <button
                    class="hover:text-foreground w-11 rounded py-0.5 text-center text-[10px] tabular-nums"
                    onclick={() => setZoom(0)}
                    title="Zurücksetzen ({mac ? '⌘' : 'Strg'} 0)">{zoom} %</button
                  >
                  <button
                    class="text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 disabled:opacity-40"
                    disabled={zoom >= ZOOM_MAX}
                    onclick={() => setZoom(1)}
                    aria-label="Vergrößern"
                    title="Vergrößern ({mac ? '⌘' : 'Strg'} +)">+</button
                  >
                </div>
              </div>
              <div class="flex items-center gap-2 px-2 py-1.5">
                <SunMoonIcon class="text-muted-foreground size-3.5" />
                <span class="flex-1">Design</span>
                <Segmented
                  value={theme.mode}
                  options={[["System", "system"], ["Hell", "light"], ["Dunkel", "dark"]] as const}
                  onchange={setMode}
                />
              </div>
              {#if claudeCfg}
                <DropdownMenu.Separator class={menuSeparator} />
                <p class="text-muted-foreground px-2 py-1 text-[10px]">Claude (neue Sitzungen)</p>
                <div class="flex items-center gap-2 px-2 py-1.5" title="Auto wechselt Hell/Dunkel live mit der App, Lila erst in neuen Sitzungen">
                  <PaletteIcon class="text-muted-foreground size-3.5" />
                  <span class="flex-1">Terminal-Theme</span>
                  <Segmented
                    value={String(claudeCfg.theme ?? "dark").startsWith("custom:open-claude:open-claude")
                      ? "custom:open-claude:open-claude"
                      : claudeCfg.theme === "auto"
                        ? "auto"
                        : ""}
                    options={[["Std", "", "Standard von Claude Code oder ein anderes Theme aus den Claude-Einstellungen"], ["Auto", "auto"], ["Lila", "custom:open-claude:open-claude"]] as const}
                    onchange={(v) => setClaudeCfg("theme", v || undefined)}
                  />
                </div>
                <div class="flex items-center gap-2 px-2 py-1.5">
                  <GaugeIcon class="text-muted-foreground size-3.5" />
                  <span class="flex-1">Effort</span>
                  <!-- Segmented statt Select: dessen Popup ausserhalb wuerde das Menue schliessen -->
                  <Segmented
                    value={claudeCfg.effortLevel ?? ""}
                    options={[["Std", "", "Standard"], ["Low", "low"], ["Mid", "medium"], ["High", "high"], ["XH", "xhigh", "Sehr hoch"], ["Max", "max"]] as const}
                    onchange={(v) => setClaudeCfg("effortLevel", v || undefined)}
                  />
                </div>
                {@render setting(
                  "Thinking-Modus",
                  claudeCfg.alwaysThinkingEnabled ?? true,
                  () => setClaudeCfg("alwaysThinkingEnabled", claudeCfg?.alwaysThinkingEnabled === false ? undefined : false),
                  BrainIcon,
                )}
              {/if}
              <DropdownMenu.Separator class={menuSeparator} />
              {@render setting("Among-Us-Easteregg", amongUs.on, () => ((amongUs.on = !amongUs.on), saveAmongUs()), GhostIcon)}
              {#if amongUs.on}
                <div class="flex items-center gap-2 px-2 py-1.5">
                  <span class="text-muted-foreground w-3.5"></span>
                  <span class="flex-1">Häufigkeit</span>
                  <Segmented value={amongUs.rate} options={RATES} onchange={(rate) => ((amongUs.rate = rate), saveAmongUs())} />
                </div>
                <label class="flex items-center gap-2 px-2 py-1.5">
                  <VolumeIcon class="text-muted-foreground size-3.5" />
                  <span class="flex-1">Sound</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    class="accent-primary w-24"
                    aria-label="Easteregg-Lautstärke"
                    bind:value={amongUs.volume}
                    onchange={saveAmongUs}
                  />
                </label>
              {/if}
              <DropdownMenu.Separator class={menuSeparator} />
              <p class="text-muted-foreground px-2 py-1 text-[10px]">Git: Rückfrage vor</p>
              {#each Object.entries(ASKS) as [key, label] (key)}
                {@render setting(label, !noAsk[key], () => setNoAsk(key as AskKey, !noAsk[key]), CircleQuestionMarkIcon)}
              {/each}
              <DropdownMenu.Separator class={menuSeparator} />
              <DropdownMenu.Item
                class={cn(menuItem, "py-1.5")}
                onSelect={() => (profilesOpen = true)}
              >
                <SparklesIcon class="text-muted-foreground size-3.5" />
                <span class="flex-1">Skill-Profile</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={cn(menuItem, "py-1.5")}
                onSelect={() => (claudeOpen = true)}
              >
                <BotIcon class="text-muted-foreground size-3.5" />
                <span class="flex-1">Claude-Einstellungen</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item class={cn(menuItem, "py-1.5")} onSelect={() => (claudeAccountsOpen = true)}>
                <UsersIcon class="text-muted-foreground size-3.5" />
                <span class="flex-1">Claude-Konten</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={cn(menuItem, "py-1.5")}
                onSelect={() => checkUpdate(true)}
              >
                <DownloadIcon class="text-muted-foreground size-3.5 {checking ? 'animate-pulse' : ''}" />
                <span class="flex-1">Nach Updates suchen</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={cn(menuItem, "py-1.5")}
                onSelect={() => (help = true)}
              >
                <KeyboardIcon class="text-muted-foreground size-3.5" />
                <span class="flex-1">Tastenkürzel</span>
                <kbd class="text-muted-foreground font-mono text-[10px]">F1</kbd>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>

    <Command.List class="max-h-none flex-1 overflow-y-auto">
      {#if error}
        <p class="text-destructive px-4 py-6 text-sm">{error}</p>
      {:else if scanning && repos.length === 0}
        <p class="text-muted-foreground px-4 py-6 text-sm">Lese Git-Repos …</p>
      {:else}
        <Command.Empty class="px-4 py-6 text-left text-sm">
          {repos.length
            ? `Kein Projekt passt zu „${query.trim()}“.`
            : root
              ? "Hier liegen keine Git-Repos."
              : "Noch keine Projekte: Ordner hinzufügen oder Dev-Ordner wählen (Strg+O)."}
        </Command.Empty>
        {#if repoGroups.length && !query.trim()}
          <Command.Group heading="Gruppen">
            {#each repoGroups as g (g.name)}
              {@const live = sessions.some((s) => s.group === g.name)}
              {@const members = g.paths.map((p) => split(repos.find((r) => r.path === p)?.rel ?? p)[1]).join(" · ")}
              <ContextMenu.Root>
                <ContextMenu.Trigger>
                  {#snippet child({ props })}
                    <Command.Item {...props} value={`group:${g.name}`} onSelect={() => launchGroup(g)} class="gap-3 px-3 py-2">
                      <span class="bg-primary/15 text-primary grid size-6 place-items-center rounded-md"><LayersIcon class="size-3.5" /></span>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-semibold" title={g.name}>{g.name}</div>
                        <div class="text-muted-foreground truncate text-[11px]" title={members}>{members}</div>
                      </div>
                      {#if live}
                        <Badge variant="outline" class="text-primary gap-1.5 text-[11px]">
                          <span class="size-2 animate-pulse rounded-full bg-current"></span>
                          läuft
                        </Badge>
                      {/if}
                      <Badge variant="outline" class="text-muted-foreground text-[11px]">{g.paths.length} Repos</Badge>
                    </Command.Item>
                  {/snippet}
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content class={cn(menuContent, "min-w-52 rounded-lg shadow-lg")}>
                    {@render repoItem(live ? "Zur Claude-Sitzung" : "Claude starten", "", () => launchGroup(g))}
                    {@render repoItem("Bearbeiten …", "", () => (groupEdit = { orig: g.name, g }))}
                    <ContextMenu.Separator class={menuSeparator} />
                    {@render repoItem("Gruppe löschen …", "", () => deleteGroup(g.name), true)}
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            {/each}
          </Command.Group>
        {/if}
        {#each groups as group (group.heading)}
          <Command.Group heading={group.heading || undefined}>
            {#each group.items as item (item.repo.path)}
              {@const nr = flat.indexOf(item) + 1}
              {@const pinned = pins.includes(item.repo.path)}
              <!-- Rechtsklick waehlt die Zeile mit aus, damit klar ist, wofuer das Menue gilt -->
              <ContextMenu.Root onOpenChange={(o) => o && (selected = item.repo.path)}>
                <ContextMenu.Trigger>
                  {#snippet child({ props })}
                    <Command.Item
                      {...props}
                      value={item.repo.path}
                      onSelect={() => (withClaude ? launch(item.repo) : openGit(item.repo))}
                      class="gap-3 px-3 py-2"
                    >
                      <button
                        class="text-muted-foreground hover:text-primary -m-1 grid size-6 place-items-center rounded p-1 {pinned
                          ? 'text-primary'
                          : 'opacity-50'}"
                        onpointerdown={(e) => e.stopPropagation()}
                        onclick={(e) => {
                          e.stopPropagation();
                          togglePin(item.repo.path);
                        }}
                        aria-label={pinned ? "Nicht mehr anpinnen" : "Anpinnen"}
                        aria-pressed={pinned}
                      >
                        <StarIcon class="size-4 {pinned ? 'fill-current' : ''}" />
                      </button>

                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-semibold" title={item.name}>
                          {#each item.name.split("") as ch, i}<span
                              class={item.marks.includes(i) ? "text-primary" : ""}>{ch}</span
                            >{/each}
                        </div>
                        {#if item.dir}
                          <div class="text-muted-foreground truncate font-mono text-[11px]" title={item.dir}>
                            {item.dir}
                          </div>
                        {/if}
                      </div>

                      {#if running.has(item.repo.path)}
                        <Badge variant="outline" class="text-primary gap-1.5 pr-0.5 text-[11px]">
                          <span class="size-2 animate-pulse rounded-full bg-current"></span>
                          läuft
                          <button
                            class="text-muted-foreground hover:bg-destructive/20 hover:text-destructive grid size-4 place-items-center rounded"
                            onpointerdown={(e) => e.stopPropagation()}
                            onclick={(e) => {
                              e.stopPropagation();
                              const s = sessions.find((s) => !s.group && s.repo.path === item.repo.path);
                              if (s) endSession(s.id);
                            }}
                            aria-label="Sitzung beenden"
                            title="Sitzung beenden"><XIcon class="size-3" /></button
                          >
                        </Badge>
                      {/if}

                      {@const prof = profileName(item.repo)}
                      {#if prof}
                        <Badge variant="outline" class="text-muted-foreground gap-1 text-[11px]" title="Skill-Profil">
                          <SparklesIcon class="size-3" />
                          {prof}
                        </Badge>
                      {/if}

                      {#each tags(item.repo) as lang (lang)}
                        {#if lang === "Unity"}
                          {@const uinfo = unityInfo[item.repo.path]}
                          <span use:onVisible={() => loadUnityInfo(item.repo.path)}>
                            <Badge variant="outline" class="text-muted-foreground gap-1.5 text-[11px]">
                              <span
                                class="size-2 rounded-full {uinfo?.editorOpen ? 'bg-success' : ''}"
                                style={uinfo?.editorOpen ? "" : `background:${LANG_COLOR.Unity}`}
                                title={uinfo ? (uinfo.editorOpen ? "Editor offen" : "Editor zu") : ""}
                              ></span>
                              {unityBadgeText(uinfo)}
                            </Badge>
                          </span>
                        {:else}
                          <Badge variant="outline" class="text-muted-foreground gap-1.5 text-[11px]">
                            <span
                              class="size-2 rounded-full"
                              style="background:{LANG_COLOR[lang] ?? 'var(--muted-foreground)'}"
                            ></span>
                            {lang}
                          </Badge>
                        {/if}
                      {/each}

                      {#if item.repo.branch}
                        <Badge variant="outline" class="text-muted-foreground gap-1 font-mono text-[11px]">
                          <GitBranchIcon class="size-3" />
                          {item.repo.branch}
                        </Badge>
                      {/if}
                      <span class="text-muted-foreground w-12 text-right font-mono text-[11px] tabular-nums">
                        {age(item.repo.last_commit)}
                      </span>
                      {#if nr <= 9}
                        <kbd
                          class="text-muted-foreground border-border hidden w-10 rounded border px-1 py-0.5 text-center font-mono text-[10px] sm:block"
                          >{mac ? "⌘" : "^"}{nr}</kbd
                        >
                      {:else}
                        <span class="hidden w-10 sm:block"></span>
                      {/if}
                    </Command.Item>
                  {/snippet}
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content
                    class={cn(menuContent, "min-w-52 rounded-lg shadow-lg")}
                  >
                    {@render repoItem("Git-Ansicht", `${mod}+G`, () => openGit(item.repo))}
                    {@render repoItem("Editor", `${mod}+⇧+E`, () => openEdit(item.repo))}
                    {@render repoItem(running.has(item.repo.path) ? "Zur Claude-Sitzung" : "Claude starten", `${mod}+⏎`, () => launch(item.repo))}
                    <ContextMenu.Separator class={menuSeparator} />
                    {@render repoItem(mac ? "Im Finder zeigen" : "Im Explorer zeigen", `${mod}+E`, () => reveal(item.repo))}
                    {@render repoItem("Im Browser öffnen", "", () => browse(item.repo))}
                    {@render repoItem("Pfad kopieren", "", () => navigator.clipboard.writeText(item.repo.path))}
                    {@render repoItem(pinned ? "Nicht mehr anpinnen" : "Anpinnen", `${mod}+P`, () => togglePin(item.repo.path))}
                    {@render repoItem("Repo-Gruppe erstellen …", "", () => (groupEdit = { orig: null, g: { name: "", paths: [item.repo.path] } }))}
                    {#if isUnity(item.repo)}
                      <ContextMenu.Separator class={menuSeparator} />
                      {@render repoItem("Unity-Editor öffnen", "", () => openUnityEditor(item.repo))}
                      {@render repoItem("Unity-Editor schließen …", "", () => (unityClosePath = item.repo.path))}
                      {@render repoItem("Unity-Support einrichten", "", () => setupUnity(item.repo))}
                    {/if}
                    <ContextMenu.Separator class={menuSeparator} />
                    {#if extra.includes(item.repo.path)}
                      {@render repoItem("Aus der Liste entfernen", "", () => unlist(item.repo.path))}
                    {:else}
                      {@render repoItem("Vom Gerät löschen …", "", () => askTrash(item.repo), true)}
                    {/if}
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            {/each}
          </Command.Group>
        {/each}
      {/if}
    </Command.List>
  </Command.Root>

  <!-- Alle Terminals bleiben gemountet, sonst stirbt claude beim Zurueckgehen. -->
  {#if view !== "list" && sessions.length > 1}
    <div class="bg-chrome border-border flex shrink-0 gap-px overflow-x-auto border-b px-1 text-[11px]" role="tablist">
      {#each sessions as s (s.id)}
        <div
          class="group flex shrink-0 items-center gap-1 rounded-t px-2 py-1 {tabOn(s)
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          <button
            role="tab"
            aria-selected={tabOn(s)}
            onclick={() => (s.group ? openGroupTab(s.id) : openTab(s.repo))}
          >
            {#if tabs[s.id]}{@const [i, c, t] = TAB[tabs[s.id]!]}<span class="mr-1 {c}" title={t}>{i}</span>{/if}{#if s.group}<LayersIcon
                class="text-primary mr-1 inline size-3"
              />{s.group}{:else}{split(s.repo.rel)[1]}{/if}
          </button>
          <button
            class="hover:bg-destructive/20 hover:text-destructive grid size-4 place-items-center rounded opacity-0 group-hover:opacity-100 {tabOn(s)
              ? 'opacity-100'
              : ''}"
            onclick={() => endSession(s.id)}
            title="Sitzung beenden"
            aria-label="Sitzung beenden"><XIcon class="size-3" /></button
          >
        </div>
      {/each}
    </div>
  {/if}
  <div class="flex min-h-0 flex-1 {view === 'term' ? '' : 'hidden'}">
    <div class="flex min-w-0 flex-1 flex-col">
      {#if activeSession}<ClaudeBar id={activeSession.id} mode={modes[activeSession.id]} onsettings={() => (claudeOpen = true)} />{/if}
      <div class="min-h-0 flex-1">
      {#each sessions as s (s.id)}
        <Terminal
          id={s.id}
          cwd={s.repo.path}
          dirs={s.dirs}
          visible={s.id === active}
          onexit={() => closeSession(s.id)}
          onmode={(m) => (modes[s.id] = m)}
        />
      {/each}
      </div>
    </div>
    {#if side && activeSession && view === "term"}
      <Splitter bind:size={sideW} invert min={260} max={720} key="term.side" />
      <div class="min-h-0 shrink-0 py-2 pr-2" style="width:{sideW}px; max-width:50%">
        <ActivityPanel cwd={activeSession.repo.path} id={activeSession.id} />
      </div>
    {/if}
  </div>

  {#if editRepo}
    <div class="min-h-0 flex-1">
      {#key editRepo.path}
        <EditorView repo={editRepo.path} />
      {/key}
    </div>
  {/if}

  {#if gitRepo}
    <div class="min-h-0 flex-1">
      {#key gitRepo.path}
        <GitView
          bind:this={gitView}
          repo={gitRepo.path}
          unity={isUnity(gitRepo)}
          kind={gitRepo.kind}
          {skillStore}
          onskills={(ps) => setProjectSkills(gitRepo!.path, ps)}
          onedit={(path) => {
            const repo = gitRepo!;
            openEdit(repo);
            if (editRepo?.path === repo.path) openFile(repo.path, path);
          }}
          {accounts}
          onaccounts={() => (accountsOpen = true)}
        />
      {/key}
    </div>
  {/if}

  <!-- Nur Status und Tastenhinweise; Aktionen und Einstellungen sitzen oben in der Suchleiste -->
  <footer
    class="bg-chrome border-border text-muted-foreground flex items-center gap-4 border-t px-3.5 py-1.5 text-[11px] whitespace-nowrap {view !== 'list'
      ? 'hidden'
      : ''}"
  >
    <span class="tabular-nums">
      {flat.length === repos.length ? `${repos.length} Projekte` : `${flat.length} von ${repos.length}`}
    </span>
    <span class="opacity-70">
      {#if scanning}Lese ein …{:else if fromCache}Stand gespeichert{:else if scannedAt}aktualisiert
        {new Date(scannedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}{/if}
    </span>
    <span class="flex-1"></span>
    {#each [["⏎", "Git"], [`${mod} ⏎`, "Claude"]] as [key, what] (key)}
      <span class="flex items-center gap-1.5">{@render kbd(key)} {what}</span>
    {/each}
    <button class="hover:text-foreground flex items-center gap-1.5" onclick={() => (help = true)}>
      {@render kbd("F1")} Hilfe
    </button>
  </footer>
</div>

{#snippet viewButton(target: string, title: string, onclick: () => void, Icon: typeof TerminalIcon, label: string)}
  <Button
    variant="ghost"
    size="sm"
    class="h-6 gap-1.5 text-[11px] {view === target ? 'text-foreground' : 'text-muted-foreground'}"
    aria-pressed={view === target}
    onclick={() => view !== target && onclick()}
    {title}><Icon class="size-3.5" /> {label}</Button
  >
{/snippet}

{#snippet repoItem(label: string, key: string, onSelect: () => void, destructive = false)}
  <ContextMenu.Item
    class={cn(menuItem, "py-1.5", destructive && "text-destructive")}
    {onSelect}
  >
    <span class="flex-1">{label}</span>
    {#if key}<kbd class="text-muted-foreground font-mono text-[10px]">{key}</kbd>{/if}
  </ContextMenu.Item>
{/snippet}

{#snippet kbd(key: string)}
  <kbd class="bg-secondary text-foreground/80 rounded px-1.5 py-px font-mono text-[10px]">{key}</kbd>
{/snippet}

{#snippet setting(label: string, on: boolean, toggle: () => void, Icon: typeof PowerIcon)}
  <!-- Schalter bleiben im offenen Menue, damit man beide nacheinander umlegen kann -->
  <DropdownMenu.Item
    class={cn(menuItem, "py-1.5")}
    closeOnSelect={false}
    onSelect={toggle}
  >
    <Icon class="text-muted-foreground size-3.5" />
    <span class="flex-1">{label}</span>
    <span
      class="relative h-3.5 w-6 rounded-full transition-colors {on ? 'bg-primary' : 'bg-secondary ring-border ring-1'}"
      aria-hidden="true"
      ><span
        class="bg-foreground absolute top-0.5 size-2.5 rounded-full transition-all {on ? 'left-3' : 'left-0.5'}"
      ></span></span
    >
  </DropdownMenu.Item>
{/snippet}

{#snippet keys(title: string, list: string[][])}
  <div>
    <h3 class="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wide">{title}</h3>
    <dl class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
      {#each list as [key, what] (key)}
        <dt class="border-border rounded border px-1.5 py-0.5 text-center font-mono text-[11px]">
          {key}
        </dt>
        <dd class="text-muted-foreground">{what}</dd>
      {/each}
    </dl>
  </div>
{/snippet}

<Dialog.Root bind:open={help}>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Tastenkürzel</Dialog.Title>
      <Dialog.Description>Alles lässt sich ohne Maus bedienen.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-6 sm:grid-cols-2">
      {@render keys("Liste", [
        ["⏎ / Klick", "Git-Ansicht öffnen"],
        [`${mod} + ⏎ / Umschalt + Klick`, "Claude im Projekt starten"],
        ["↑ ↓", "Projekt wählen"],
        [`${mod} + 1 … 9`, "Claude im Treffer starten"],
        [`${mod} + G`, "Git-Ansicht öffnen"],
        [`${mod} + ⇧ + E`, "Editor öffnen"],
        [`${mod} + N`, "Repo klonen"],
        [`${mod} + ⇧ + N`, "Neues Repo anlegen"],
        [`${mod} + K`, "Suche fokussieren"],
        [`${mod} + P`, "Projekt anpinnen"],
        [`${mod} + E`, "Ordner im Explorer öffnen"],
        [`${mod} + R`, "Neu einlesen"],
        [`${mod} + O`, "Dev-Ordner wechseln"],
        [`${mod} + T`, "Claude ohne Projekt (im Home-Ordner)"],
        ["Rechtsklick", "Weitere Aktionen, z. B. vom Gerät löschen"],
        ["Esc", "Suche leeren, sonst schließen (bzw. ins Tray)"],
      ])}
      <div class="grid content-start gap-6">
        {@render keys("Überall", [
          [`${mod} + + / − / 0`, "Zoom größer / kleiner / zurücksetzen"],
          [`${mod} + Mausrad`, "Zoom (Fokus und Maus außerhalb der Vorschau)"],
        ])}
        {@render keys("Terminal, Git und Editor", [
          [`⇧ + Esc / ${mod} + ⇧ + W`, "Zurück zur Liste, Sitzung läuft weiter"],
          ["Alt + E", "Ordner im Explorer öffnen"],
          ["Alt + G", "Im Terminal und Editor: Git-Ansicht öffnen"],
          [`${mod} + ⇧ + E`, "Editor öffnen"],
          ["Strg + ⇧ + C / Strg + V", "Im Terminal: kopieren / einfügen"],
        ])}
        {@render keys("Editor", [
          [`${mod} + S`, "Datei speichern"],
          [`${mod} + P`, "Datei suchen und öffnen"],
          ["Tab ziehen", "Umsortieren, an eine Kante ziehen teilt den Bereich"],
        ])}
        {@render keys("Git-Ansicht", [
          ["Esc", "Zurück zur Liste"],
          [`${mod} + 1 … 6`, "Änderungen / Verlauf / Releases / Actions / Unity / Skills"],
          [`${mod} + ⇧ + F`, "Fetch"],
          [`${mod} + ⇧ + L`, "Pull"],
          [`${mod} + ⇧ + P`, "Push"],
          ["F5", "Aktualisieren"],
          [`${mod} + ⏎`, "Commit"],
          ["Leertaste", "Datei stagen / unstagen"],
          ["F7 / ⇧ + F7", "Merge-Editor: nächster / vorheriger Konflikt"],
          [`${mod} + S`, "Merge-Editor: speichern"],
        ])}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<RootDialog open={setup || rootOpen} first={setup} {root} onchoose={chooseRoot} onclose={() => (rootOpen = false)} />

<Dialog.Root open={doomed !== null} onOpenChange={(o) => !o && !trashing && (doomed = null)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>„{doomed && split(doomed.repo.rel)[1]}“ vom Gerät löschen?</Dialog.Title>
      <Dialog.Description>
        Der Ordner wandert in den Papierkorb, auf dem Server bleibt alles. Eine laufende Claude-Sitzung wird beendet.
      </Dialog.Description>
    </Dialog.Header>
    <p class="text-muted-foreground truncate font-mono text-[11px]" title={doomed?.repo.path}>{doomed?.repo.path}</p>
    {#if doomed?.risks.length}
      <ul class="bg-destructive/10 text-destructive list-disc rounded-md py-2 pr-3 pl-7 text-xs">
        {#each doomed.risks as r (r)}<li>{r}</li>{/each}
      </ul>
    {/if}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={trashing} onclick={() => (doomed = null)}>Abbrechen</Button>
      <Button variant="destructive" size="sm" disabled={trashing} onclick={trashRepo}>
        {trashing ? "Lösche …" : "In den Papierkorb"}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<ClaudeSettingsDialog bind:open={claudeOpen} />
<ClaudeAccountsDialog bind:open={claudeAccountsOpen} running={sessions.length} />
<GroupDialog
  group={groupEdit?.g ?? null}
  {repos}
  taken={repoGroups.map((g) => g.name).filter((n) => n !== groupEdit?.orig)}
  onsave={(g) => saveGroup(groupEdit?.orig ?? null, g)}
  oncancel={() => (groupEdit = null)}
/>

<ProfilesDialog bind:open={profilesOpen} store={skillStore} {repos} repo={current?.repo.path} onsave={saveProfiles} />

<UnityCloseDialog bind:path={unityClosePath} onclosed={(p) => loadUnityInfo(p, true)} />

{#if store}
  <AccountsDialog bind:open={accountsOpen} {store} bind:accounts />
{/if}
<CloneDialog
  bind:open={cloneOpen}
  {accounts}
  root={root || home}
  existing={repos.map((r) => r.path)}
  onclone={cloned}
  onaccounts={() => {
    cloneOpen = false;
    accountsOpen = true;
  }}
/>
<CreateDialog
  bind:open={createOpen}
  {accounts}
  root={root || home}
  oncreate={cloned}
  onaccounts={() => {
    createOpen = false;
    accountsOpen = true;
  }}
/>

<IdeDiff />

<!-- Ein Dialog fuer alle Rueckfragen aus confirm() (window.confirm geht in der Webview nicht). Zuletzt im Markup,
     damit er ueber anderen offenen Dialogen liegt. -->
<ConfirmDialog
  open={!!confirming.q}
  title={confirming.q?.title ?? ""}
  action={confirming.q?.action ?? ""}
  tone={confirming.q?.tone}
  wide={!!confirming.q?.items}
  onconfirm={() => answer(true)}
  oncancel={() => answer(false)}
>
  {#if confirming.q?.message}
    <p class="text-muted-foreground text-sm break-words whitespace-pre-line">{confirming.q.message}</p>
  {/if}
  {#if confirming.q?.items}
    <ul class="border-border/60 divide-border/60 divide-y rounded-lg border">
      {#each confirming.q.items as it (it.name)}
        <li class="flex items-start gap-2.5 px-3 py-2">
          <PackageIcon class="text-primary mt-0.5 size-4 shrink-0" />
          <div class="min-w-0">
            <div class="text-sm font-medium">{it.name}</div>
            <div class="text-muted-foreground text-xs break-words">{it.detail}</div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</ConfirmDialog>

