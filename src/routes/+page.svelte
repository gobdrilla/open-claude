<script lang="ts">
  import { age, cn } from "$lib/utils";
  import { onMount, tick, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getVersion } from "@tauri-apps/api/app";
  import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { homeDir } from "@tauri-apps/api/path";
  import { open } from "@tauri-apps/plugin-dialog";
  import { load, type Store } from "@tauri-apps/plugin-store";
  import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { check, type Update } from "@tauri-apps/plugin-updater";
  import { FILES_APP } from "$lib/editor.logic";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

  import { Badge, Button, Command, ConfirmDialog, ContextItem, Dialog, IconButton, Input, Segmented, TextButton, menuContent, menuItem, menuSeparator, menuShortcut } from "$lib/atelier-ui";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import { answer, confirm, confirming } from "$lib/confirm.svelte";
  import { pasted } from "$lib/pasteimg.svelte";
  import RefreshIcon from "@lucide/svelte/icons/refresh-cw";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import StarIcon from "@lucide/svelte/icons/star";
  import MinusIcon from "@lucide/svelte/icons/minus";
  import SquareIcon from "@lucide/svelte/icons/square";
  import XIcon from "@lucide/svelte/icons/x";
  import LayersIcon from "@lucide/svelte/icons/layers";
  import GroupDialog, { type RepoGroup } from "$lib/components/GroupDialog.svelte";
  import ClaudeAccountsDialog from "$lib/components/ClaudeAccountsDialog.svelte";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import ClaudeSettingsDialog from "$lib/components/ClaudeSettingsDialog.svelte";
  import SettingsDialog from "$lib/components/SettingsDialog.svelte";
  import { initExtensions } from "$lib/extensions.svelte";
  import { ContextMenu, DropdownMenu } from "bits-ui";
  import Notice from "$lib/components/Notice.svelte";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import { fuzzy } from "$lib/fuzzy";
  import { clampZoom, zoomKey, zoomStep } from "$lib/zoom";
  import IdleAmongUs from "$lib/components/IdleAmongUs.svelte";
  import Terminal from "$lib/components/Terminal.svelte";
  import ClaudeBar from "$lib/components/ClaudeBar.svelte";
  import { bannerText, tabState, type TabState } from "$lib/claudemode";
  import ActivityPanel from "$lib/components/ActivityPanel.svelte";
  import Splitter, { stored } from "$lib/components/Splitter.svelte";
  import GitView from "$lib/components/git/GitView.svelte";
  import EditorView from "$lib/components/editor/EditorView.svelte";
  import { drop, gitHook, isDirty, open as openFile } from "$lib/editor.svelte";
  import { stop as stopLsp } from "$lib/lsp.svelte";
  import { claudeTarget, ide, listenIde } from "$lib/ide.svelte";
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
  import SkillsDialog from "$lib/components/skills/SkillsDialog.svelte";
  import { sync, touched, profileFor, managed, pkey, emptyProject, migrateNamespace, type SkillStore, type ProjectSkills } from "$lib/skills";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import FolderInputIcon from "@lucide/svelte/icons/folder-input";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import FolderDownIcon from "@lucide/svelte/icons/folder-down";
  import PackageIcon from "@lucide/svelte/icons/package";
  import UserPlusIcon from "@lucide/svelte/icons/user-plus";
  import ShareDialog from "$lib/components/ShareDialog.svelte";
  import JoinDialog from "$lib/components/JoinDialog.svelte";
  import { shares } from "$lib/share.svelte";
  import SessionOverview, { type Panel } from "$lib/components/start/SessionOverview.svelte";

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
  let input = $state<HTMLInputElement | null>(null);
  // Sessions (auch mehrere pro Projekt); die Tab-Leiste ueber dem Terminal wechselt zwischen ihnen.
  // group/dirs: Sitzung einer Repo-Gruppe, startet in repo und kennt dirs als weitere Arbeitsordner
  // guest: Einladung einer geteilten Sitzung, claude laeuft beim Host; host = dessen cwd (nach dem Verbinden).
  // repo bleibt dann leer (frei), sonst hielte die App den Host-Ordner fuer ein eigenes Projekt.
  let sessions = $state<{ id: string; repo: Repo; group?: string; dirs?: string[]; guest?: string; host?: string }[]>([]);
  // Projekt-Sitzung, bei mehreren die aktive. Nie eine Gruppen-Sitzung.
  const sessionOf = (p: string) => {
    const own = sessions.filter((s) => !s.group && s.repo.path === p);
    return own.find((s) => s.id === active) ?? own.find((s) => s.id === lastShown[p]) ?? own[0];
  };
  // Zuletzt gezeigte Sitzung je Projekt: nach Editor/Git zurueck zu genau dieser, nicht zur ersten.
  const lastShown = $state<Record<string, string>>({});
  // sendToClaude (Kontextmenues "An Claude") schreibt in die Projekt-Sitzung.
  claudeTarget.find = (p) => sessionOf(p)?.id;
  let repoGroups = $state<RepoGroup[]>([]);
  // Gruppe im Dialog; orig = bisheriger Name (null = neu)
  let groupEdit = $state<{ orig: string | null; g: RepoGroup } | null>(null);
  let active = $state<string | null>(null);
  // Berechtigungsmodus je Session, gelesen aus der Terminal-Fusszeile (Kopfleiste)
  let modes = $state<Record<string, string>>({});
  // Denk-Stufe je Session aus dem Fusszeilen-Hinweis, bis die Mod sie nach dem ersten Turn meldet
  let efforts = $state<Record<string, string>>({});
  // Tab-Status je Session aus dem Panel der Mod: laeuft, Rueckfrage, fertig (bis angesehen)
  let tabs = $state<Record<string, TabState>>({});
  // Was eine Hintergrund-Session fragt (Tool + Befehl); weg, sobald beantwortet oder Tab angesehen.
  let banners = $state<Record<string, string>>({});
  // Last session panel per session (context, current tool, todos) for the start page; filled by the tab poll.
  let panels = $state<Record<string, Panel>>({});
  const TAB: Record<string, [string, string, string]> = {
    run: ["◐", "text-primary animate-pulse", "Claude arbeitet"],
    ask: ["?", "text-warning font-bold", "Claude wartet auf dich"],
    done: ["✓", "text-success", "Claude ist fertig"],
  };
  const activeSession = $derived(sessions.find((s) => s.id === active));
  $effect(() => {
    const s = activeSession;
    if (s && !s.group && !s.guest) lastShown[s.repo.path] = s.id;
  });
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
  let shareOpen = $state(false);
  let joinOpen = $state(false);
  let accounts = $state<Account[]>([]);
  let skillStore = $state<SkillStore>({ profiles: {}, kindProfiles: {}, projects: {} });
  let profilesOpen = $state(false);
  let skillsOpen = $state(false);
  let claudeOpen = $state(false);
  let claudeAccountsOpen = $state(false);
  let settingsOpen = $state(false);

  // Nie ein Dialog ueber einem Dialog: ein Unterdialog (Konten, Profile, Hilfe …) ersetzt den aufrufenden und
  // gibt beim Schliessen an ihn zurueck, wie eine Unterseite.
  type Sub = "accounts" | "claudeAccounts" | "claude" | "profiles" | "help";
  let returnTo = $state.raw<{ sub: Sub; reopen: () => void } | null>(null);
  const subOpen = (s: Sub) =>
    ({ accounts: accountsOpen, claudeAccounts: claudeAccountsOpen, claude: claudeOpen, profiles: profilesOpen, help })[s];
  function openSub(sub: Sub, from: "settings" | "clone" | "create") {
    if (from === "settings") settingsOpen = false;
    else if (from === "clone") cloneOpen = false;
    else createOpen = false;
    if (sub === "accounts") accountsOpen = true;
    else if (sub === "claudeAccounts") claudeAccountsOpen = true;
    else if (sub === "claude") claudeOpen = true;
    else if (sub === "profiles") profilesOpen = true;
    else help = true;
    returnTo = {
      sub,
      reopen: () => (from === "settings" ? (settingsOpen = true) : from === "clone" ? (cloneOpen = true) : (createOpen = true)),
    };
  }
  $effect(() => {
    if (!returnTo || subOpen(returnTo.sub)) return;
    const { reopen } = returnTo;
    returnTo = null;
    reopen();
  });
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
    ? "Kein Admin-Passwort nötig; der normale Ruhezustand bleibt unverändert."
    : navigator.userAgent.includes("Windows")
      ? "Ändert solange die Deckel-Aktion des Energieplans. Auf Geräten mit Modern Standby unzuverlässig; danach schläft er erst nach der normalen Leerlaufzeit."
      : "Braucht systemd-logind; ob GNOME/KDE die Sperre beachten, ist nicht geprüft.";
  /** ask: aus den Einstellungen deren Inline-Rueckfrage, sonst der globale Dialog. */
  async function toggleLidAwake(ask = confirm) {
    const msg =
      "Der Laptop bleibt zugeklappt wach, solange eine Claude-Session gerade arbeitet (Display aus). Wartet Claude auf dich oder ist fertig, schläft er normal ein. " +
      "In der Tasche kann er dabei heiß werden; unter 20 % Akku wird nicht wach gehalten.\n\n" +
      lidNote();
    if (!lidAwake && !(await ask(msg, "Einschalten", "Wach bei zugeklapptem Laptop?", { tone: "default" }))) return;
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
    // Natives WebView-Kontextmenue nie zeigen (Browser-Eintraege, auf Links "In neuem Fenster oeffnen").
    // Bubble-Phase: eigene Menues (bits-ui) haben ihr contextmenu da schon verarbeitet.
    // Opt-in spellcheck fields keep the native menu: it carries the correction suggestions.
    const onMenu = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('[spellcheck="true"]')) e.preventDefault();
    };
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
  let version = $state("");
  getVersion().then((v) => (version = v));
  let updating = $state(false);
  let checking = $state(false);
  /** Returns the result message for a manual check (shown in the settings dialog). */
  async function checkUpdate(manual = false) {
    if (updating || checking) return "";
    checking = true;
    try {
      update = (await check()) ?? update;
      return manual && !update ? "L'Atelier ist aktuell." : "";
    } catch (e) {
      return manual ? `Update-Prüfung fehlgeschlagen: ${e}` : "";
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

  /** Ohne Tray beendet Schliessen die App (lib.rs, on_window_event); Rust fragt bei laufenden Sitzungen und ungespeicherten Dateien (preview::quit). */
  /** byKey: per Esc ausgeloest; das beendet ohne Tray die App, darum auch ohne Sitzung nachfragen. */
  async function closeWindow(byKey = false) {
    if (byKey && !tray && !sessions.length && !(await confirm("Esc schließt das Fenster und beendet die App.", "Beenden", "L'Atelier de Claude beenden?"))) return;
    getCurrentWindow().close();
  }

  async function installUpdate(ask = confirm) {
    // Der Neustart laeuft an der Rueckfrage in Rust vorbei.
    if (isDirty() && !(await ask("Ungespeicherte Änderungen im Editor gehen dabei verloren.", "Neu starten", "Update installieren?"))) return;
    if (sessions.length && !(await ask(sessionsLost(), "Neu starten", "Update installieren?"))) return;
    updating = true;
    try {
      await update!.download();
      // Windows: install() beendet die App per process::exit, RunEvent::Exit (Aufraeumen) liefe nicht.
      if (!mac) await invoke("before_update");
      await update!.install();
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
    // Not awaited: the extension scan must not delay the start.
    initExtensions(store);
    autostart = await isEnabled().catch(() => false);
    // Linux: Tray-Icons brauchen unter GNOME eine Erweiterung, ohne sie waere das versteckte Fenster weg.
    tray = (await store.get<boolean>("tray")) ?? !navigator.userAgent.includes("Linux");
    lidAwake = (await store.get<boolean>("lidAwake")) ?? false;
    // Meldung vom Aufraeumen nach einem Absturz kam vor diesem Listener: hier abholen.
    const awakeErr = await invoke<string | null>("set_awake", { on: lidAwake });
    if (awakeErr) notice = awakeErr;
    amongUs = { ...amongUs, ...(await store.get<typeof amongUs>("amongUs")) };
    const storedSkills: SkillStore = {
      profiles: (await store.get<SkillStore["profiles"]>("skillProfiles")) ?? {},
      kindProfiles: (await store.get<SkillStore["kindProfiles"]>("kindProfiles")) ?? {},
      projects: (await store.get<SkillStore["projects"]>("projectSkills")) ?? {},
    };
    skillStore = migrateNamespace(storedSkills);
    // settings.local.json follows on the next sync (terminal start)
    if (JSON.stringify(skillStore) !== JSON.stringify(storedSkills)) await saveSkills();
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
    // Session, die bei unfokussiertem Fenster zu fragen begann; beim Zurueckkehren aktivieren (Desktop hat keinen Klick-Callback).
    let pendingFocus: string | null = null;
    let asked = false;
    // Zuletzt gemeldete Rueckfrage je Session.
    const asks = new Map<string, string>();
    // Abgelehnt oder nicht verfuegbar: still, Banner und Dock-Huepfen bleiben.
    const notify = async (body: string) => {
      let ok = await isPermissionGranted();
      if (!ok && !asked) {
        asked = true;
        ok = (await requestPermission()) === "granted";
      }
      // Linux ohne Benachrichtigungsdienst wirft: still bleiben.
      try {
        if (ok) sendNotification({ title: "Claude wartet auf dich", body });
      } catch {}
    };
    const onFocus = () => {
      const s = sessions.find((s) => s.id === pendingFocus);
      pendingFocus = null;
      // Nicht activate: in Editor/Git-Ansicht oeffnete openTab das Repo dort statt das Terminal mit der Rueckfrage.
      if (s && tabs[s.id] === "ask") openSessionTab(s.id);
    };
    window.addEventListener("focus", onFocus);
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
    // Claude (or another tool) can switch branches without the app noticing: follow .git/HEAD of the open projects.
    const followBranches = async () => {
      const open = [...sessions.map((s) => s.repo), gitRepo, editRepo].filter((r): r is Repo => !!r?.path);
      const paths = [...new Set(open.map((r) => r.path))];
      if (!paths.length) return;
      const heads = await invoke<string[]>("repo_branches", { paths }).catch(() => []);
      const now = new Map(paths.map((p, i) => [p, heads[i]]));
      let moved = false;
      for (const r of [...open, ...repos]) {
        const b = now.get(r.path);
        if (b && b !== r.branch) {
          r.branch = b;
          moved ||= r.path === gitRepo?.path;
        }
      }
      if (moved) gitView?.refresh(false);
    };
    const poll = async () => {
      followBranches().catch(() => {});
      const focused = document.hasFocus();
      let alert = false;
      for (const s of sessions) {
        const p = await invoke<Panel | null>("claude_panel", { id: s.id }).catch(() => null);
        if (!sessions.includes(s)) continue;
        if (p) panels[s.id] = p;
        const prev = tabs[s.id];
        const seen = focused && view === "term" && s.id === active;
        const next = tabState(prev, p, seen);
        const text = next === "ask" ? bannerText(label(s), p?.waitingFor) : undefined;
        // Neue Rueckfrage auch ohne Statuswechsel (zweite direkt nach der ersten): Text vergleichen.
        const fresh = text !== undefined && (prev !== "ask" || text !== asks.get(s.id));
        if (text === undefined) asks.delete(s.id);
        else asks.set(s.id, text);
        if (seen || text === undefined) delete banners[s.id];
        else banners[s.id] = text;
        if (fresh && !seen && !focused) {
          pendingFocus = s.id;
          notify(text).catch(() => {});
        }
        alert ||= (fresh && !seen) || (next === "done" && prev !== "done");
        if (next !== prev) tabs[s.id] = next;
      }
      if (alert && !focused) win.requestUserAttention(UserAttentionType.Informational).catch(() => {});
      const n = sessions.filter((s) => tabs[s.id] === "ask" || tabs[s.id] === "done").length;
      if (n !== badge) win.setBadgeCount((badge = n) || undefined).catch(() => {});
    };
    const t = setInterval(tick, 1500);
    return () => (clearInterval(t), window.removeEventListener("focus", onFocus));
  });

  /** Offene Session des Projekts zeigen, sonst eine neue starten. */
  /** neu: weitere Sitzung im selben Projekt statt zur offenen zu wechseln. */
  async function launch(repo?: Repo, neu = false) {
    if (!repo) return;
    if (gitRepo && gitView && !(await gitView.canLeave())) return;
    // Vor dem Start schreiben, damit claude die Skills schon sieht; ein Fehler haelt den Start nicht auf.
    // Nie konfigurierte Projekte bleiben unberuehrt.
    if (!isFree(repo) && !running.has(repo.path) && managed(skillStore, repo.path, repo.kind)) await syncSkills([repo.path]);
    leaveGit();
    editRepo = null;
    let s = neu ? undefined : sessionOf(repo.path);
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
    if (!(await confirm("Die Projekte selbst bleiben unverändert.", "Löschen", `Gruppe „${name}“ löschen?`))) return;
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
  function openGit(repo?: Repo, commit: string | null = null) {
    // Gast-Sitzung: kein Ordner auf diesem Rechner
    if (!repo?.path) return;
    active = null;
    editRepo = null;
    gitCommit = commit;
    gitRepo = repo;
  }
  /** Commit the git view opens with (blame click in the editor). */
  let gitCommit = $state<string | null>(null);
  gitHook.showCommit = (repo, sha) => editRepo?.path === repo && openGit(editRepo, sha);

  /** Genau diese Sitzung im Terminal zeigen: wie launch, ohne nach Projekt oder Gruppe aufzuloesen. */
  async function openSessionTab(id: string) {
    if (gitRepo && gitView && !(await gitView.canLeave())) return;
    leaveGit();
    editRepo = null;
    active = id;
  }

  // Title bar view switcher: fixed order, Editor/Git only where the project has a folder here.
  const VIEW_OPEN = { term: (r?: Repo) => launch(r), edit: openEdit, git: openGit } as const;
  type ViewKey = keyof typeof VIEW_OPEN;
  const ROW_VIEWS = [
    ["Claude", "term", TerminalIcon, 1],
    ["Editor", "edit", FileCodeIcon, 2],
    ["Git", "git", GitBranchIcon, 3],
  ] as const;
  // Account-wide usage limits from any session panel (footer of the start page).
  const LIMIT_NAME: Record<string, string> = { five_hour: "5 h", seven_day: "Woche" };
  const limits = $derived(
    (Object.values(panels).find((p) => p.limits?.length)?.limits ?? []).flatMap((l) => (LIMIT_NAME[l.kind] ? [[LIMIT_NAME[l.kind], l] as const] : [])),
  );
  // Group heads stay below the uppercase section heads (Wartet auf dich / Projekte)
  const subHead = "[&_[data-command-group-heading]]:text-meta [&_[data-command-group-heading]]:font-normal";
  // Click/Enter on the start page always opens Claude.
  const openRepo = (repo: Repo) => launch(repo);
  const views = $derived(
    [
      ["Claude", "term", `Claude (${mod}+1)`, TerminalIcon],
      ...(isFree(viewRepo) ? [] : [["Editor", "edit", `Editor (${mod}+2)`, FileCodeIcon] as const]),
      ...(viewRepo?.path ? [["Git", "git", `Git (${mod}+3)`, GitBranchIcon] as const] : []),
    ] as const satisfies readonly (readonly [string, ViewKey, string, typeof TerminalIcon])[],
  );
  // Ab der zweiten Sitzung im selben Projekt durchnummeriert
  const label = (s: (typeof sessions)[number]) => {
    if (s.group) return s.group;
    if (s.guest) return `Gast: ${s.host ? split(s.host)[1] : "verbinde …"}`;
    const n = sessions.filter((o) => !o.group && o.repo.path === s.repo.path).indexOf(s);
    return (isFree(s.repo) ? "Ohne Projekt" : split(s.repo.rel)[1]) + (n > 0 ? ` ${n + 1}` : "");
  };

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
    const picked = await open({ directory: true, title: "Projektordner hinzufügen", defaultPath: root || home });
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
    // Back on the list the project just left is selected, so Strg+D/Enter act on it and not on a stale hover.
    const from = viewRepo?.path;
    editRepo = null;
    active = null;
    leaveGit();
    if (from && flat.some((h) => h.repo.path === from)) selected = from;
    await tick();
    input?.focus();
  }

  /** Per Klick beenden: claude arbeitet evtl. noch, daher nachfragen. */
  async function endSession(id: string) {
    if (await confirm("Ein laufender claude-Prozess wird abgebrochen.", "Beenden", "Sitzung beenden?")) closeSession(id);
  }

  const forget = (id: string) => (delete tabs[id], delete modes[id], delete efforts[id], delete banners[id], delete panels[id], delete shares[id]);

  /** Geteilter Sitzung beitreten: eigener Tab, das Terminal verbindet sich zum Host. */
  async function join(ticket: string) {
    if (gitRepo && gitView && !(await gitView.canLeave())) return;
    leaveGit();
    editRepo = null;
    const id = crypto.randomUUID();
    sessions.push({ id, repo: { path: "", rel: "~", branch: "", last_commit: "", langs: [] }, guest: ticket });
    active = id;
  }

  /** Aus der Liste nehmen; der Terminal-Unmount schliesst die PTY. */
  function closeSession(id: string) {
    forget(id);
    sessions = sessions.filter((s) => s.id !== id);
    // Wie bei Tabs ueblich zur letzten verbliebenen Session, erst ohne Session zurueck zur Liste.
    if (active === id) sessions.length ? (active = sessions.at(-1)!.id) : back();
  }

  // Esc gehoert offenen Dialogen/Menues. Die schliessen schon vor onKey, daher hier vorher nachsehen.
  let overlayOnEsc = false;
  const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"]';
  // Alt held: the start page shows the Alt+1..9 hints only then.
  let altHeld = $state(false);
  const noteAlt = (e: KeyboardEvent) => (altHeld = e.altKey && !e.ctrlKey && !e.metaKey);
  const noteCtrl = (e: KeyboardEvent) => {
    noteAlt(e);
    // Capture am Fenster: vor xterm und CodeMirror, die Shell bekommt die Taste nicht.
    const dir = zoomKey(e, mac);
    if (dir !== null) {
      e.preventDefault();
      e.stopPropagation();
      setZoom(dir);
      return;
    }
    if (e.key === "Escape") overlayOnEsc = !!document.querySelector(OVERLAY);
    // WebView2 wuerde neu laden: Sitzungen verwaisen. Im Terminal gehoert Strg+R/F5 der Shell (xterm verhindert selbst).
    const reload = e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r");
    if (reload && !(e.target instanceof Element && e.target.closest(".xterm"))) e.preventDefault();
    // Strg+1/2/3 (Claude/Editor/Git) and Strg+Umschalt+E (file manager) in every view, also in xterm (Strg+2/3
    // would send NUL/ESC there) and CodeMirror. Digits by code, so AZERTY works too. AltGr = Strg+Alt stays input.
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    const n = ctrl && !e.shiftKey ? ["Digit1", "Digit2", "Digit3"].indexOf(e.code) : -1;
    const files = ctrl && e.shiftKey && e.key.toLowerCase() === "e";
    if ((n < 0 && !files) || document.querySelector(OVERLAY)) return;
    e.preventDefault();
    e.stopPropagation();
    // On the start page: the selected project.
    const repo = view === "list" ? current?.repo : viewRepo;
    if (files) return void (repo?.path && reveal(repo));
    const v = ROW_VIEWS[n][1];
    if (v !== view && (view === "list" || views.some((o) => o[1] === v))) VIEW_OPEN[v](repo);
  };

  // Alle Dialoge ausser der Hilfe (F1 schaltet sie um)
  const anyDialog = $derived(
    cloneOpen || createOpen || accountsOpen || shareOpen || joinOpen || claudeOpen || setup || rootOpen || !!doomed || profilesOpen || skillsOpen || !!groupEdit ||
      claudeAccountsOpen || settingsOpen || !!confirming.q || !!unityClosePath || ide.diffs.length > 0,
  );

  function onKey(e: KeyboardEvent) {
    // Im Terminal gehoeren fast alle Kuerzel der Shell (Readline: Strg+R/K/E/P/O/G ...).
    // Die Git-Ansicht hat ihre eigenen Kuerzel in GitView.svelte.
    // Der Editor hat Strg+S/Esc selbst (EditorView, CodeMirror); Esc verlaesst ihn nicht.
    if (view !== "list") {
      if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "w") || (e.shiftKey && e.key === "Escape")) {
        e.preventDefault();
        back();
      } else if (e.key === "Escape" && view === "git") {
        // Offene Dialoge/Menues schliessen sich selbst, Eingabefelder verlieren nur den Fokus.
        const el = document.activeElement;
        if (overlayOnEsc) return;
        e.preventDefault();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();
        else back();
      }
      return;
    }
    // Esc hat schon ein Dialog oder Menue geschlossen, nicht auch noch das Fenster.
    if (e.key === "Escape" && (overlayOnEsc || e.defaultPrevented)) return;
    // Ohne Alt: AltGr ist unter Windows Strg+Alt und loest sonst Kuerzel statt Zeichen aus.
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (e.key === "F1" || (ctrl && e.key === "/")) {
      if (!anyDialog) help = !help;
      e.preventDefault();
      return;
    }
    // Offene Dialoge bekommen ihre Tasten selbst.
    if (help || anyDialog) return;

    // Alt+1..9: n-th hit in its last view. By code: Option+digit on the Mac types a character.
    const nth = e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code) ? flat[Number(e.code[5]) - 1] : undefined;
    if (nth) {
      openRepo(nth.repo);
    } else if (ctrl && e.key.toLowerCase() === "k") {
      input?.select();
    } else if (ctrl && e.key.toLowerCase() === "r") {
      rescan();
    } else if (ctrl && e.key.toLowerCase() === "o") {
      pickRoot();
    } else if (ctrl && e.key.toLowerCase() === "d") {
      if (current) togglePin(current.repo.path);
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") {
      createOpen = true;
    } else if (ctrl && e.key.toLowerCase() === "n") {
      cloneOpen = true;
    } else if (ctrl && e.key.toLowerCase() === "t") {
      launchFree();
    } else if (e.key === "Escape") {
      if (query) query = "";
      else closeWindow(true);
    } else {
      return;
    }
    e.preventDefault();
  }

  // Home-Ordner als ~ (alle Plattformen); bis homeDir() da ist, wenigstens das Windows-Muster.
  const short = $derived.by(() => {
    if (!root) return "Kein Dev-Ordner";
    const h = home.replace(/[\\/]+$/, "");
    if (h && (root === h || root.startsWith(h + "/") || root.startsWith(h + "\\"))) return "~" + root.slice(h.length);
    return root.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, "~");
  });
</script>

<svelte:window onkeydown={onKey} onkeydowncapture={noteCtrl} onkeyup={noteAlt} onblur={() => (altHeld = false)} />

{#if amongUs.on}<IdleAmongUs rate={amongUs.rate} volume={amongUs.volume} />{/if}

<div
  class="bg-chrome border-border flex h-9 items-center border-b {lights ? '' : 'pl-3.5'}"
  style:padding-left={lights ? `${8000 / zoom}px` : undefined}
  data-tauri-drag-region
>
  {#if viewRepo}
    <!-- Global only: navigation, project context, view switcher. View actions live in each view's header. -->
    <!-- Switcher follows right after project and branch; the rest of the bar stays a drag region. -->
    <div class="flex min-w-0 items-center" data-tauri-drag-region>
    <Button
      variant="quiet"
      size="xs"
      class="{lights ? '' : '-ml-1.5'} mr-2 gap-1.5"
      onclick={back}
      title="Zurück zu den Projekten ({mod}+Umschalt+W)"><ArrowLeftIcon class="size-3.5" /> Projekte</Button
    >
    <div class="flex min-w-0 items-center gap-2 overflow-hidden" title={viewRepo.path} data-tauri-drag-region>
      <span class="text-ui truncate font-semibold" data-tauri-drag-region>
        {split(viewRepo.rel)[1]}
      </span>
      {#if split(viewRepo.rel)[0]}
        <span
          class="text-muted-foreground text-meta hidden truncate font-mono sm:block"
          data-tauri-drag-region
        >
          {split(viewRepo.rel)[0]}
        </span>
      {/if}
      {#if viewRepo.branch}
        <Badge variant="outline" class="text-muted-foreground text-meta shrink-0 gap-1 font-mono">
          <GitBranchIcon class="size-3" />
          {viewRepo.branch}
        </Badge>
      {/if}
    </div>
    </div>
    <span class="bg-border mx-3 h-4 w-px shrink-0"></span>
    <Segmented
      variant="nav"
      label="Ansicht"
      value={view as ViewKey}
      options={views}
      onchange={(v) => v !== view && VIEW_OPEN[v](viewRepo)}
    />
    <div class="min-w-2 flex-1 self-stretch" data-tauri-drag-region></div>
  {:else}
    <img
      src="/logo.png"
      alt=""
      class="mr-2 size-4 [image-rendering:pixelated]"
      data-tauri-drag-region
    />
    <span class="text-muted-foreground flex-1 text-ui font-semibold" data-tauri-drag-region>
      L'Atelier de Claude
    </span>
  {/if}
  {#if update}
    <Button
      variant="ghost"
      size="xs"
      class="text-primary mr-1 gap-1.5"
      disabled={updating}
      onclick={() => installUpdate()}
      title={`Update installieren und neu starten${update.body ? `\n\n${update.body}` : ""}`}
      ><DownloadIcon class="size-3.5" /> {updating ? "Aktualisiere…" : `Update ${update.version}`}</Button
    >
  {/if}
  {#if missing.length}
    <Button
      variant="ghost"
      size="xs"
      class="mr-1 gap-1.5 text-warning"
      disabled={installingDeps}
      onclick={installDeps}
      title={`Fehlt auf diesem Rechner: ${missing.map((n) => DEPS[n]).join(", ")}. Klick installiert.`}
      ><DownloadIcon class="size-3.5" />
      {installingDeps ? "Installiere…" : `${missing.map((n) => DEPS[n]).join(" + ")} installieren`}</Button
    >
  {/if}
  {#if !mac}
    <!-- Fensterknoepfe wie bei Windows: nicht per Tab erreichbar, kein Fokusrahmen, Fokus bleibt im Terminal/der Suche. -->
    <IconButton
      size="window"
      tabindex={-1}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => getCurrentWindow().minimize()}
      label="Minimieren"
      title={undefined}><MinusIcon class="size-3.5" /></IconButton
    >
    <IconButton
      size="window"
      tabindex={-1}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => getCurrentWindow().toggleMaximize()}
      label={maximized ? "Wiederherstellen" : "Maximieren"}
      title={undefined}
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
    </IconButton>
    <IconButton
      size="window"
      tone="close"
      tabindex={-1}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => closeWindow()}
      label="Schließen"
      title={undefined}><XIcon class="size-3.5" /></IconButton
    >
  {/if}
</div>

<div class="flex h-[calc(100vh-2.25rem)] flex-col">
  <Notice bind:text={skillNotice} />
  <!-- Ueber allen Ansichten: Fehler aus Update, Wach-Halt oder Alt+E kommen auch aus Terminal und Git -->
  <Notice bind:text={notice} />
  {#if !notice}<Notice bind:text={okNotice} kind="ok" />{/if}
  <Notice bind:text={ide.notice} kind="note" timeout={3000} />
  <!-- Session tabs at the top in every view (also the start page), from the first session on. -->
  {#if sessions.length}
    <div class="bg-chrome border-border text-ui flex shrink-0 gap-px overflow-x-auto border-b px-1" role="tablist" aria-label="Sitzungen">
      {#each sessions as s (s.id)}
        {@const on = s.id === active}
        <ContextMenu.Root>
        <ContextMenu.Trigger
          class="group flex shrink-0 items-center gap-1 rounded-t px-2 py-1 {on
            ? 'bg-background text-foreground shadow-[inset_0_-2px_0_var(--primary)]'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          <!-- -mx-1 px-1: focus ring gets air around the text without moving the label. -->
          <TextButton
            tone="plain"
            class="-mx-1 inline px-1"
            role="tab"
            aria-selected={on}
            onclick={() => openSessionTab(s.id)}
          >
            {#if tabs[s.id]}{@const [i, c, t] = TAB[tabs[s.id]!]}<span class="mr-1 {c}" title={t}>{i}</span>{/if}{#if s.group}<LayersIcon
                class="text-primary mr-1 inline size-3"
              />{/if}{label(s)}{#if banners[s.id]}<span
                class="text-warning ml-1.5 inline-block max-w-80 truncate align-bottom"
                title={banners[s.id]}>{banners[s.id]}</span
              >{/if}
          </TextButton>
          <IconButton
            size="xs"
            tone="danger"
            reveal={!on}
            onclick={() => endSession(s.id)}
            label="Sitzung beenden"><XIcon class="size-3" /></IconButton
          >
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class={cn(menuContent, "min-w-44 rounded-lg shadow-lg")}>
            <ContextItem label="Sitzung beenden …" destructive onSelect={() => endSession(s.id)} />
          </ContextMenu.Content>
        </ContextMenu.Portal>
        </ContextMenu.Root>
      {/each}
    </div>
  {/if}
  <Command.Root
    shouldFilter={false}
    bind:value={selected}
    loop
    class="bg-background flex-1 rounded-none! p-0 {view !== 'list' ? 'hidden!' : ''}"
  >
    <div class="border-border flex items-center gap-2 border-b py-1 pr-2 pl-2">
      <div class="flex-1 [&_[data-slot=command-input-wrapper]]:p-0">
        <Command.Input
          bind:ref={input}
          bind:value={query}
          placeholder="Projekt suchen"
          autofocus
          class="h-12! text-body!"
        />
      </div>
      <!-- At most three actions, all labelled except the gear; the rest lives in the + Projekt menu and the settings. -->
      <div class="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          class="gap-1.5 {sessions.some((s) => isFree(s.repo)) ? 'text-primary' : ''}"
          onclick={launchFree}
          title="Claude im Home-Ordner starten, ohne Git ({mod}+T)"><TerminalIcon class="size-3.5" /> Claude ohne Projekt</Button
        >
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button {...props} size="sm" class="gap-1.5"><PlusIcon class="size-3.5" /> Projekt <ChevronDownIcon class="size-3" /></Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} class={cn(menuContent, "min-w-56 rounded-lg shadow-lg")}>
              {#each [
                [FolderDownIcon, "Repo klonen …", `${mod}+N`, () => (cloneOpen = true)],
                [FolderPlusIcon, "Neues Repo anlegen …", `${mod}+⇧+N`, () => (createOpen = true)],
                [FolderInputIcon, "Ordner hinzufügen …", "", addProject],
                [UserPlusIcon, "Sitzung beitreten …", "", () => (joinOpen = true)],
                [FolderIcon, "Dev-Ordner wechseln …", `${mod}+O`, pickRoot],
              ] as const as [Icon, label, key, onSelect], i (label)}
                {#if i === 4}<DropdownMenu.Separator class={menuSeparator} />{/if}
                <DropdownMenu.Item class={cn(menuItem, "py-1.5")} {onSelect}>
                  <Icon class="text-muted-foreground size-3.5" />
                  <span class="flex-1">{label}</span>
                  {#if key}<kbd class={menuShortcut}>{key}</kbd>{/if}
                </DropdownMenu.Item>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Button variant="ghost" size="icon-sm" class="text-muted-foreground" title="Einstellungen" aria-label="Einstellungen" onclick={() => (settingsOpen = true)}
          ><SettingsIcon class="size-4" /></Button
        >
      </div>
    </div>

    <Command.List class="max-h-none flex-1 overflow-y-auto">
      {#if error}
        <p class="text-destructive px-4 py-6 text-body">{error}</p>
      {:else if scanning && repos.length === 0}
        <p class="text-muted-foreground px-4 py-6 text-body">Lese Git-Repos …</p>
      {:else}
        <Command.Empty class="px-4 py-6 text-left text-body">
          {repos.length
            ? `Kein Projekt passt zu „${query.trim()}“.`
            : root
              ? "Hier liegen keine Git-Repos."
              : `Noch keine Projekte: Ordner hinzufügen oder Dev-Ordner wählen (${mod}+O).`}
        </Command.Empty>
        {#if view === "list" && sessions.some((s) => tabs[s.id] === "ask") && !query.trim()}
          <SessionOverview
            items={sessions.map((s) => ({ id: s.id, name: label(s), state: tabs[s.id], panel: panels[s.id] }))}
            onopen={openSessionTab}
          />
          <h2 class="text-muted-foreground text-meta flex gap-1.5 px-3 pt-4 font-semibold tracking-wide uppercase">
            Projekte <span class="font-normal">{repos.length}</span>
          </h2>
        {/if}
        {#if repoGroups.length && !query.trim()}
          <Command.Group heading="Gruppen" class={subHead}>
            {#each repoGroups as g (g.name)}
              {@const live = sessions.some((s) => s.group === g.name)}
              {@const members = g.paths.map((p) => split(repos.find((r) => r.path === p)?.rel ?? p)[1]).join(" · ")}
              <ContextMenu.Root>
                <ContextMenu.Trigger>
                  {#snippet child({ props })}
                    <Command.Item {...props} value={`group:${g.name}`} onSelect={() => launchGroup(g)} class="gap-3 px-3 py-2">
                      <span class="bg-primary/15 text-primary grid size-6 place-items-center rounded-md"><LayersIcon class="size-3.5" /></span>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-body font-semibold" title={g.name}>{g.name}</div>
                        <div class="text-muted-foreground truncate text-meta" title={members}>{members}</div>
                      </div>
                      {#if live}
                        <Badge variant="outline" class="text-primary gap-1.5 text-meta">
                          <span class="size-2 animate-pulse rounded-full bg-current"></span>
                          läuft
                        </Badge>
                      {/if}
                      <Badge variant="outline" class="text-muted-foreground text-meta">{g.paths.length} {g.paths.length === 1 ? "Projekt" : "Projekte"}</Badge>
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
          <Command.Group heading={group.heading || undefined} class={subHead}>
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
                      onSelect={() => openRepo(item.repo)}
                      class="gap-3 px-3 py-2"
                    >
                      <IconButton
                        size="bare"
                        tone="primary"
                        active={pinned}
                        class="-m-1 p-1 {pinned ? '' : 'opacity-50'}"
                        onpointerdown={(e) => e.stopPropagation()}
                        onclick={(e) => {
                          e.stopPropagation();
                          togglePin(item.repo.path);
                        }}
                        label={pinned ? "Nicht mehr anpinnen" : "Anpinnen"}
                        title={undefined}
                        aria-pressed={pinned}
                      >
                        <StarIcon class="size-4 {pinned ? 'fill-current' : ''}" />
                      </IconButton>

                      <div class="min-w-0 flex-1">
                        <div class="truncate text-body font-semibold" title={item.name}>
                          {#each item.name.split("") as ch, i}<span
                              class={item.marks.includes(i) ? "text-primary" : ""}>{ch}</span
                            >{/each}
                        </div>
                        {#if item.dir}
                          <div class="text-muted-foreground truncate font-mono text-meta" title={item.dir}>
                            {item.dir}
                          </div>
                        {/if}
                      </div>

                      {#if running.has(item.repo.path)}
                        <Badge variant="outline" class="text-primary gap-1.5 pr-0.5 text-meta">
                          <span class="size-2 animate-pulse rounded-full bg-current"></span>
                          läuft
                          <IconButton
                            size="xs"
                            tone="danger"
                            onpointerdown={(e) => e.stopPropagation()}
                            onclick={(e) => {
                              e.stopPropagation();
                              const s = sessionOf(item.repo.path);
                              if (s) endSession(s.id);
                            }}
                            label="Sitzung beenden"><XIcon class="size-3" /></IconButton
                          >
                        </Badge>
                      {/if}

                      {@const prof = profileName(item.repo)}
                      <!-- Meta gives way to the view actions on hover/keyboard selection -->
                      <span class="flex items-center gap-3 group-data-selected/command-item:hidden">
                        {#if prof}
                          <Badge variant="outline" class="text-muted-foreground gap-1 text-meta" title="Skill-Profil">
                            <SparklesIcon class="size-3" />
                            {prof}
                          </Badge>
                        {/if}

                        {#each tags(item.repo) as lang (lang)}
                          {#if lang === "Unity"}
                            {@const uinfo = unityInfo[item.repo.path]}
                            <span use:onVisible={() => loadUnityInfo(item.repo.path)}>
                              <Badge variant="outline" class="text-muted-foreground gap-1.5 text-meta">
                                <span
                                  class="size-2 rounded-full {uinfo?.editorOpen ? 'bg-success' : ''}"
                                  style={uinfo?.editorOpen ? "" : `background:${LANG_COLOR.Unity}`}
                                  title={uinfo ? (uinfo.editorOpen ? "Editor offen" : "Editor zu") : ""}
                                ></span>
                                {unityBadgeText(uinfo)}
                              </Badge>
                            </span>
                          {:else}
                            <Badge variant="outline" class="text-muted-foreground gap-1.5 text-meta">
                              <span
                                class="size-2 rounded-full"
                                style="background:{LANG_COLOR[lang] ?? 'var(--muted-foreground)'}"
                              ></span>
                              {lang}
                            </Badge>
                          {/if}
                        {/each}

                        {#if item.repo.branch}
                          <Badge variant="outline" class="text-muted-foreground gap-1 font-mono text-meta">
                            <GitBranchIcon class="size-3" />
                            {item.repo.branch}
                          </Badge>
                        {/if}
                        <!-- Alt+1..9 hint replaces the age only while Alt is held -->
                        {#if altHeld && nr <= 9}
                          <kbd class="text-muted-foreground border-border text-meta w-12 rounded border text-center font-mono"
                            >{mac ? `⌥${nr}` : `Alt+${nr}`}</kbd
                          >
                        {:else}
                          <span class="text-muted-foreground w-12 text-right font-mono text-meta tabular-nums">
                            {age(item.repo.last_commit)}
                          </span>
                        {/if}
                      </span>
                      <!-- Only the selected row renders its actions: 3 buttons per row cost ~24k nodes at 300 projects. -->
                      {#if selected === item.repo.path}
                      <div class="-my-1 hidden items-center gap-0.5 group-data-selected/command-item:flex">
                        {#each ROW_VIEWS as [name, key, Icon, n] (key)}
                          <Button
                            variant="ghost"
                            size="xs"
                            class="text-ui gap-1.5 {key === 'term' && running.has(item.repo.path) ? 'text-primary' : ''}"
                            title="{name} ({mod}+{n})"
                            onpointerdown={(e) => e.stopPropagation()}
                            onclick={(e) => {
                              e.stopPropagation();
                              VIEW_OPEN[key](item.repo);
                            }}><Icon class="size-3.5" /> {name}</Button
                          >
                        {/each}
                      </div>
                      {/if}
                    </Command.Item>
                  {/snippet}
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content
                    class={cn(menuContent, "min-w-52 rounded-lg shadow-lg")}
                  >
                    {@render repoItem(running.has(item.repo.path) ? "Zur Claude-Sitzung" : "Claude starten", `${mod}+1`, () => launch(item.repo))}
                    {#if running.has(item.repo.path)}
                      {@render repoItem("Weitere Claude-Sitzung", "", () => launch(item.repo, true))}
                    {/if}
                    {@render repoItem("Editor", `${mod}+2`, () => openEdit(item.repo))}
                    {@render repoItem("Git-Ansicht", `${mod}+3`, () => openGit(item.repo))}
                    <ContextMenu.Separator class={menuSeparator} />
                    {@render repoItem(`Im ${FILES_APP} zeigen`, `${mod}+⇧+E`, () => reveal(item.repo))}
                    {@render repoItem("Im Browser öffnen", "", () => browse(item.repo))}
                    {@render repoItem("Pfad kopieren", "", () => navigator.clipboard.writeText(item.repo.path))}
                    {@render repoItem(pinned ? "Nicht mehr anpinnen" : "Anpinnen", `${mod}+D`, () => togglePin(item.repo.path))}
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
  <div class="flex min-h-0 flex-1 flex-col {view === 'term' ? '' : 'hidden'}">
    {#if activeSession}
      {@const s = activeSession}
      <ClaudeBar
        id={s.id}
        mode={modes[s.id]}
        footerEffort={efforts[s.id]}
        guest={!!s.guest}
        {side}
        ontoggleside={toggleSide}
        share={s.guest ? undefined : { on: !!shares[s.id], guests: shares[s.id]?.guests ?? 0, open: () => (shareOpen = true) }}
        onnew={s.group || s.guest ? undefined : () => launch(s.repo, true)}
        onskills={s.group || s.guest || isFree(s.repo) ? undefined : () => (skillsOpen = true)}
        onsettings={() => (claudeOpen = true)}
      />
    {/if}
    <!-- ClaudeBar spans the full width so the activity panel starts below its bottom border. -->
    <div class="flex min-h-0 flex-1">
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="min-h-0 flex-1">
      {#each sessions as s (s.id)}
        <Terminal
          id={s.id}
          cwd={s.repo.path}
          dirs={s.dirs}
          guest={s.guest}
          onguest={(cwd) => (s.host = cwd)}
          visible={s.id === active}
          onexit={() => closeSession(s.id)}
          onmode={(m) => (modes[s.id] = m)}
          oneffort={(e) => (efforts[s.id] = e)}
          onfile={async (path, line, col) => {
            await openEdit(s.repo);
            if (editRepo === s.repo) await openFile(s.repo.path, path, line, col && col - 1);
          }}
        />
      {/each}
      </div>
    </div>
    {#if side && activeSession && view === "term"}
      <Splitter bind:size={sideW} invert min={260} max={720} key="term.side" />
      <div class="min-h-0 shrink-0 py-2 pr-2" style="width:{sideW}px; max-width:max(260px, 40%)">
        <ActivityPanel cwd={activeSession.host ?? activeSession.repo.path} id={activeSession.id} guest={!!activeSession.guest} />
      </div>
    {/if}
  </div>
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
          commit={gitCommit}
          unity={isUnity(gitRepo)}
          onedit={async (path, line) => {
            const repo = gitRepo!;
            // openEdit waits for the git view to let go; before that editRepo is still unset.
            await openEdit(repo);
            if (editRepo?.path === repo.path) await openFile(repo.path, path, line);
          }}
          {accounts}
          onaccounts={() => (accountsOpen = true)}
          onbranch={(b) => gitRepo && (gitRepo.branch = b)}
        />
      {/key}
    </div>
  {/if}

  <!-- Nur Status und Tastenhinweise; Aktionen und Einstellungen sitzen oben in der Suchleiste -->
  <footer
    class="bg-chrome border-border text-muted-foreground flex items-center gap-4 border-t px-3.5 py-1.5 text-meta whitespace-nowrap {view !== 'list'
      ? 'hidden'
      : ''}"
  >
    {#if limits.length}
      <span class="tabular-nums" title="Nutzungslimits des Claude-Kontos">
        Limits {limits.map(([name, l]) => `${name} ${Date.parse(l.resetsAt ?? "") <= Date.now() ? 0 : Math.round(l.percentUsed)} %`).join(" · ")}
      </span>
    {/if}
    <span class="flex-1"></span>
    <span class="tabular-nums">
      {flat.length === repos.length ? `${repos.length} Projekte` : `${flat.length} von ${repos.length}`}
    </span>
    <TextButton
      class="max-w-44 gap-1 font-mono"
      onclick={pickRoot}
      title={root ? `Dev-Ordner wechseln (${mod}+O): ${root}` : `Dev-Ordner wählen (${mod}+O)`}
      ><FolderIcon class="size-3 shrink-0" /><span class="truncate">{short}</span></TextButton
    >
    <span class="flex items-center gap-1 opacity-70">
      {#if scanning}Lese ein …{:else if fromCache}Stand gespeichert{:else if scannedAt}aktualisiert
        {new Date(scannedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}{/if}
      <IconButton size="sm" onclick={rescan} label="Neu einlesen ({mod}+R)"><RefreshIcon class="size-3 {scanning ? 'animate-spin' : ''}" /></IconButton>
    </span>
    <TextButton tone="plain" class="gap-1.5" onclick={() => (help = true)}>
      {@render kbd("F1")} Hilfe
    </TextButton>
  </footer>
</div>

{#snippet repoItem(label: string, key: string, onSelect: () => void, destructive = false)}
  <ContextMenu.Item
    class={cn(menuItem, "py-1.5", destructive && "text-destructive")}
    {onSelect}
  >
    <span class="flex-1">{label}</span>
    {#if key}<kbd class={menuShortcut}>{key}</kbd>{/if}
  </ContextMenu.Item>
{/snippet}

{#snippet kbd(key: string)}
  <kbd class="bg-secondary text-foreground/80 border-border rounded border px-1.5 py-px font-mono text-[10px]">{key}</kbd>
{/snippet}

{#snippet keys(title: string, list: string[][])}
  <section>
    <h3 class="text-muted-foreground text-meta mb-2 font-semibold tracking-wide uppercase">{title}</h3>
    <dl class="text-body grid grid-cols-[12rem_1fr] items-center gap-x-4 gap-y-1.5">
      {#each list as [key, what] (key)}
        <dt class="border-border text-meta justify-self-start rounded border px-1.5 py-0.5 font-mono">{key}</dt>
        <dd class="text-muted-foreground">{what}</dd>
      {/each}
    </dl>
  </section>
{/snippet}

<RootDialog open={setup || rootOpen} first={setup} {root} onchoose={chooseRoot} onclose={() => (rootOpen = false)} />

<Dialog.Root open={doomed !== null} onOpenChange={(o) => !o && !trashing && (doomed = null)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>„{doomed && split(doomed.repo.rel)[1]}“ vom Gerät löschen?</Dialog.Title>
      <Dialog.Description>
        Der Ordner wandert in den Papierkorb, auf dem Server bleibt alles. Eine laufende Claude-Sitzung wird beendet.
      </Dialog.Description>
    </Dialog.Header>
    <p class="text-muted-foreground truncate font-mono text-meta" title={doomed?.repo.path}>{doomed?.repo.path}</p>
    {#if doomed?.risks.length}
      <ul class="bg-destructive/10 text-destructive list-disc rounded-md py-2 pr-3 pl-7 text-ui">
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

<SettingsDialog
  bind:open={settingsOpen}
  bind:amongUs
  {mac}
  {version}
  {update}
  {checking}
  {updating}
  {autostart}
  {tray}
  {lidAwake}
  {zoom}
  onautostart={toggleAutostart}
  ontray={toggleTray}
  onlidawake={toggleLidAwake}
  onzoom={setZoom}
  onamongus={saveAmongUs}
  oncheckupdate={() => checkUpdate(true)}
  oninstall={installUpdate}
  onclaude={() => openSub("claude", "settings")}
  onclaudeaccounts={() => openSub("claudeAccounts", "settings")}
  onprofiles={() => openSub("profiles", "settings")}
  ongitaccounts={() => openSub("accounts", "settings")}
  onhelp={() => openSub("help", "settings")}
/>
<Dialog.Root bind:open={help}>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Tastenkürzel</Dialog.Title>
      <Dialog.Description>Ein Schema für alle Ansichten. Alles lässt sich auch ohne Maus bedienen.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-5">
      {@render keys("Überall", [
        [`${mod} + 1 / 2 / 3`, "Claude / Editor / Git des Projekts (auf der Startseite: des gewählten)"],
        [`${mod} + ⇧ + E`, `Projektordner im ${FILES_APP} öffnen`],
        [`⇧ + Esc / ${mod} + ⇧ + W`, "Zurück zu den Projekten, Sitzung läuft weiter"],
        [`F1 / ${mod} + /`, "Diese Übersicht"],
        [`${mod} + + / − / 0`, "Zoom größer / kleiner / zurücksetzen"],
        [`${mod} + Mausrad`, "Zoom (Fokus und Maus außerhalb der Vorschau)"],
      ])}
      {@render keys("Startseite", [
        ["⏎ / Klick", "Claude im Projekt öffnen"],
        ["↑ ↓", "Projekt wählen"],
        [`${mac ? "⌥" : "Alt"} + 1 … 9`, "Treffer 1 … 9 öffnen (Ziffern erscheinen, solange die Taste gedrückt ist)"],
        [`${mod} + K`, "Suche fokussieren"],
        [`${mod} + D`, "Projekt anpinnen"],
        [`${mod} + N`, "Repo klonen"],
        [`${mod} + ⇧ + N`, "Neues Repo anlegen"],
        [`${mod} + T`, "Claude ohne Projekt (im Home-Ordner)"],
        [`${mod} + R`, "Neu einlesen"],
        [`${mod} + O`, "Dev-Ordner wechseln"],
        ["Rechtsklick", "Weitere Aktionen, z. B. vom Gerät löschen"],
        ["Esc", "Suche leeren, sonst schließen (bzw. ins Tray)"],
      ])}
      {@render keys("Claude", [[mac ? "⌘ + C / ⌘ + V" : "Strg + ⇧ + C / Strg + V", "Im Terminal kopieren / einfügen"]])}
      {@render keys("Editor", [
        [`${mod} + S`, "Datei speichern"],
        [`${mod} + P`, "Datei suchen und öffnen"],
        [`${mac ? "⌃" : "Strg"} + G`, "Zu Zeile springen"],
        [`${mac ? "⌃" : "Strg"} + Tab / ${mac ? "⌃" : "Strg"} + ⇧ + Tab`, "Zuletzt verwendete Dateien durchgehen, Loslassen öffnet"],
        ["Doppelklick auf Tab", "Vorschau-Tab (kursiv) behalten"],
        ["Tab ziehen", "Umsortieren, an eine Kante ziehen teilt den Bereich"],
      ])}
      {@render keys("Git", [
        ["Esc", "Zurück zu den Projekten"],
        ["Alt + 1 … 5", "Änderungen / Verlauf / Releases / CI / Unity"],
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
  </Dialog.Content>
</Dialog.Root>
<ClaudeSettingsDialog bind:open={claudeOpen} />
<ClaudeAccountsDialog bind:open={claudeAccountsOpen} running={sessions.length} />
{#if activeSession && !activeSession.guest}<ShareDialog bind:open={shareOpen} id={activeSession.id} cwd={activeSession.repo.path} />{/if}
<JoinDialog bind:open={joinOpen} onjoin={join} />
<GroupDialog
  group={groupEdit?.g ?? null}
  {repos}
  taken={repoGroups.map((g) => g.name).filter((n) => n !== groupEdit?.orig)}
  onsave={(g) => saveGroup(groupEdit?.orig ?? null, g)}
  oncancel={() => (groupEdit = null)}
/>

{#if activeSession && !activeSession.group && !activeSession.guest && !isFree(activeSession.repo)}
  {@const r = activeSession.repo}
  <SkillsDialog
    bind:open={skillsOpen}
    repo={r.path}
    name={split(r.rel)[1]}
    kind={r.kind}
    store={skillStore}
    onproject={(ps) => setProjectSkills(r.path, ps)}
  />
{/if}
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
  onaccounts={() => openSub("accounts", "clone")}
/>
<CreateDialog
  bind:open={createOpen}
  {accounts}
  root={root || home}
  oncreate={cloned}
  onaccounts={() => openSub("accounts", "create")}
/>

<IdeDiff />

<!-- Ein Dialog fuer alle Rueckfragen aus confirm() (window.confirm geht in der Webview nicht). Nur ausserhalb von
     Dialogen nutzen; in Dialogen fragt die Zeile selbst nach (Inline-Bestaetigung). -->
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
    <p class="text-muted-foreground text-body break-words whitespace-pre-line">{confirming.q.message}</p>
  {/if}
  {#if confirming.q?.items}
    <ul class="border-border/60 divide-border/60 divide-y rounded-lg border">
      {#each confirming.q.items as it (it.name)}
        <li class="flex items-start gap-2.5 px-3 py-2">
          <PackageIcon class="text-primary mt-0.5 size-4 shrink-0" />
          <div class="min-w-0">
            <div class="text-body font-medium">{it.name}</div>
            <div class="text-muted-foreground text-ui break-words">{it.detail}</div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</ConfirmDialog>

