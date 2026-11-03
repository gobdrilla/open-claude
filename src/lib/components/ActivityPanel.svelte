<script lang="ts" module>
  // Schluessel `${session}:${id}` — ids sind nur innerhalb einer Session eindeutig.
  // Kacheln zeigen Vorschauen aus Rust (claude_thumb, wenige KB), die bleiben fuer alle Panels gemerkt. Volle
  // Bilder nur fuer die Grossansicht und nur die letzten CACHE_MAX: Vollbilder als Kacheln liessen Sessions mit
  // hunderten Bildern ruckeln und belegten GB.
  const thumbCache = new Map<string, string>();
  const cache = new Map<string, string>();
  const CACHE_MAX = 8;
</script>

<script lang="ts">
  import { confirm } from "$lib/confirm.svelte";
  import { pasted } from "$lib/pasteimg.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, untrack } from "svelte";
  import { Badge, Button, Dialog, Empty, IconButton, Row, SectionToggle, Segmented, Tabs, TextButton, menuContent, menuItem, menuSeparator } from "$lib/atelier-ui";
  import Markdown from "$lib/components/Markdown.svelte";
  import ZoomImage from "$lib/components/ZoomImage.svelte";
  import BtwPanel from "$lib/components/BtwPanel.svelte";
  import { age } from "$lib/utils";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import { DropdownMenu } from "bits-ui";
  import WorkflowDialog from "$lib/components/WorkflowDialog.svelte";
  import { ptyWrite } from "$lib/files";
  import { blocked } from "$lib/ide.svelte";
  import { screens } from "$lib/components/Terminal.svelte";
  import { fromScript, metaOf, type WfFile } from "$lib/workflow.logic";
  import { byFolder, chunks, tally } from "$lib/activity.logic";

  type Step = { at: number; tool: string; summary: string };
  type Agent = {
    id: string;
    label: string;
    phase: string;
    state: string;
    started: number;
    last_at: number;
    tokens: number;
    tool_calls: number;
    steps: Step[];
    text: string | null;
    result: string | null;
    prompt: string | null;
  };
  type Run = {
    id: string;
    name: string;
    status: string;
    started: number;
    duration_ms: number;
    tokens: number;
    phases: string[];
    planned: number[];
    agents: Agent[];
  };
  type Img = { id: number; at: number; kind: string; label: string; missing?: boolean };
  type Prompt = { at: number; text: string };
  type Entry = { at: number; kind: "prompt" | "text" | "tool"; tool: string; summary: string; body: string; output: string | null; error: boolean };
  // Kopie aus src-tauri/mods/open-claude/types/index.d.ts (Import scheitert an `declare module 'claude-code'`).
  type Limit = { kind: string; percentUsed: number; resetsAt?: string };
  type Panel = {
    startedAt: number;
    context: { tokens: number | null; window: number; percent: number | null };
    compactLeft: number | null;
    limits: Limit[];
    cost: number | null;
    model: string;
    effort: string | null;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
    turns: number;
    active: { id: string; tool: string; target: string; state: "run" | "ok" | "err" }[];
    todos: { content: string; status: string }[];
    busy?: boolean;
    waiting?: boolean;
  };
  type Mode = { name: string; level: string };
  type Activity = { session: string | null; alive: boolean; runs: Run[]; agents: Agent[]; images: Img[]; prompts: Prompt[]; panel: Panel | null; limits: Limit[] | null; modes: Mode[] };

  // guest: Gast-Sitzung, Daten kommen vom Host (share_call), Vorlagen bearbeiten und btw nur dort.
  let { cwd, id, guest = false }: { cwd: string; id: string; guest?: boolean } = $props();
  const call = <T,>(cmd: string, args: Record<string, unknown>) => (guest ? invoke<T>("share_call", { id, cmd, args }) : invoke<T>(cmd, args));

  let data = $state<Activity | null>(null);
  let error = $state("");
  // Fehler einer Aktion (Springen, Verlauf, Bild): eigene Zeile, error ersetzt den ganzen Inhalt und blitzt nur auf.
  let actionError = $state("");
  let tplError = $state("");
  let tab = $state<"session" | "work" | "img" | "prompts">("session");
  // Session-Daten der Mod im Terminal; Countdowns rechnen gegen now.
  let panel = $state<Panel | null>(null);
  let now = $state(Date.now());
  // Offen/zu je Run; ohne Eintrag sind laufende Runs offen.
  let openRuns = $state<Record<string, boolean>>({});
  // Collapsed sections of the Arbeit tab, kept per app run (all open by default).
  let folded = $state({ tpl: false, runs: false, agents: false });
  const sectionHead = "text-muted-foreground py-1 text-ui font-normal";
  // Aufgeklappte Prompts, Schluessel `${run}:${agent}`; standardmaessig zu.
  let openPrompts = $state<Record<string, boolean>>({});
  // Phasen-Override des Users, Schluessel `${run}:${phase}`; ohne Eintrag offen, solange sie laeuft oder Fehler hat.
  let openPhases = $state<Record<string, boolean>>({});
  // Run im grossen Dialog und dessen Statusfilter
  let big = $state<string | null>(null);
  let filter = $state<"all" | "running" | "error">("all");
  let bigScroller = $state<HTMLElement>();
  // Geoeffneter Agent: volle Zeitleiste statt Liste.
  let focus = $state<{ run: string; agent: string } | null>(null);
  // Aufgeklappte Tool-Gruppen je Index; selbst gefuehrt, weil open={…} sonst bei jedem Poll zurueckspringt.
  let openGroups = $state<Record<number, boolean>>({});
  let log = $state<Entry[] | null>(null);
  let scroller = $state<HTMLElement>();
  // Bild-URL je sichtbarer Kachel
  let thumbs = $state<Record<string, string>>({});
  // Kacheln, deren Vorschau scheiterte (z. B. Format, das image nicht kennt): "Keine Vorschau" statt leer
  let noThumb = $state<Record<string, boolean>>({});
  // Volles Bild der Lightbox
  let fullUrl = $state<string>();
  // Bild-id in der Lightbox (nicht Index: neue Bilder verschieben die Liste)
  let shown = $state<number | null>(null);
  // Workflow-Vorlagen (global + Projekt); Claude kann neue schreiben, darum mitpollen
  let templates = $state<WfFile[]>([]);
  let wfOpen = $state(false);
  let wfEntry = $state<WfFile | null>(null);

  const STATUS: Record<string, [string, string, string]> = {
    running: ["◐", "text-primary animate-pulse", "läuft"],
    done: ["✓", "text-success", "fertig"],
    completed: ["✓", "text-success", "fertig"],
    error: ["✕", "text-destructive", "Fehler"],
    failed: ["✕", "text-destructive", "Fehler"],
    aborted: ["⊘", "text-muted-foreground", "abgebrochen"],
    open: ["○", "text-muted-foreground/60", "offen"],
    killed: ["⊘", "text-muted-foreground", "abgebrochen"],
    paused: ["⏸", "text-muted-foreground", "pausiert"],
  };
  const status = (s: string) => STATUS[s] ?? ["○", "text-muted-foreground", s];

  const runningRuns = $derived(data?.runs.filter((r) => r.status === "running").length ?? 0);
  const runningAgents = $derived(data?.agents.filter((a) => a.state === "running").length ?? 0);
  const live = $derived(!!runningRuns || !!runningAgents || !!panel?.active.some((a) => a.state === "run"));
  // Status in der Fusszeile; Glyphen und Farben wie an den Sitzungs-Tabs oben. Ohne laufendes claude
  // kann busy in der Panel-Datei haengen geblieben sein.
  const claudeState = $derived(
    !data?.alive
      ? null
      : panel?.waiting
        ? (["?", "text-warning font-bold", "wartet auf dich"] as const)
        : panel?.busy
          ? (["◐", "text-primary animate-pulse", "Claude arbeitet"] as const)
          : null,
  );
  // Eingefuegt, aber noch nicht im Transkript (Prompt nicht abgeschickt): id = -n, Bild aus pasted.local.
  const local = $derived(pasted.local[id] ?? {});
  // Im Transkript angekommen: dasselbe n, nicht aelter als die Einfuegung (nach /clear zaehlt claude neu ab 1).
  const arrived = (d: Activity | null, n: string, at: number) => !!d?.images.some((m) => m.kind === "paste" && m.label === `Eingefügt #${n}` && m.at >= at);
  const pending = $derived(
    Object.entries(local)
      .filter(([n, m]) => !arrived(data, n, m.at))
      .map(([n, m]): Img => ({ id: -Number(n), at: m.at, kind: "paste", label: `Eingefügt #${n}` })),
  );
  // Neueste zuerst ueber alle Transkripte (Session und Agents); gleiche Zeit: spaeter gefunden zuerst.
  const imgs = $derived([...(data?.images ?? []), ...pending].reverse().sort((a, b) => b.at - a.at));
  // Screenshot series (> 10 files from one folder) get their own group; the lightbox follows this order.
  const imgGroups = $derived(byFolder(imgs));
  const ordered = $derived(imgGroups.flatMap(([, l]) => l));
  const fileName = (m: Img) => (m.kind === "file" || m.kind === "read" ? m.label.split(/[\\/]/).pop() || m.label : m.label);

  let busy = false;
  async function poll() {
    if (busy || document.visibilityState !== "visible") return;
    busy = true;
    const c = cwd,
      i = id;
    try {
      const d = await call<Activity>("claude_activity", { cwd: c, id: i });
      // Halb geschriebene Datei liefert null: letzten Wert behalten.
      if (c === cwd && i === id) (data = d), (panel = d.panel ?? panel), (now = Date.now()), (error = "");
      // Uebernommene Einfuegungen freigeben, sonst sammeln sich Blob-URLs bis zum Schliessen des Terminals.
      if (c === cwd && i === id)
        for (const [n, m] of Object.entries(pasted.local[i] ?? {}))
          if (arrived(d, n, m.at)) URL.revokeObjectURL(m.url), delete pasted.local[i][Number(n)];
      // Laufender Agent: Zeitleiste mitziehen; fertiger wird nur einmal geladen.
      if (focus && (!log || focused?.a.state === "running")) loadLog();
      if (tab === "work") loadTemplates();
    } catch (e) {
      if (c === cwd && i === id) error = String(e);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  });

  $effect(() => {
    void cwd;
    void id;
    data = null;
    panel = null;
    thumbs = {};
    noThumb = {};
    actionError = "";
    shown = null;
    focus = null;
    log = null;
    templates = [];
    tplError = "";
    busy = false; // alte Anfrage wird per c !== cwd verworfen
    poll();
  });

  async function loadTemplates() {
    const c = cwd;
    try {
      const l = await call<WfFile[]>("workflows_list", { cwd: c });
      if (c === cwd) (templates = l), (tplError = "");
    } catch (e) {
      if (c === cwd) tplError = String(e);
    }
  }
  $effect(() => {
    if (tab === "work") loadTemplates();
  });

  const tpls = $derived(
    templates.map((f) => {
      const b = fromScript(f.text);
      const m = b ? null : metaOf(f.text);
      return { f, builder: !!b, name: b?.name ?? m?.name ?? f.file, description: b?.description ?? m?.description ?? "" };
    }),
  );
  const shadowed = (scope: string, name: string) => scope === "project" && tpls.some((x) => x.f.scope === "user" && x.name === name);

  function editTemplate(f: WfFile | null) {
    wfEntry = f;
    wfOpen = true;
  }
  async function deleteTemplate(f: WfFile, name: string) {
    if (!(await confirm(`Vorlage „${name}“ löschen?`, "Löschen"))) return;
    try {
      await invoke("workflows_delete", { cwd, scope: f.scope, file: f.file });
      loadTemplates();
    } catch (e) {
      tplError = String(e);
    }
  }
  // Ohne Enter: Args dahinter tippen, dann selbst abschicken; startet nie versehentlich einen teuren Lauf
  // Wartet claude auf eine Freigabe, waere der Text dort die Antwort.
  const startTemplate = async (f: WfFile) => {
    if (await blocked(id)) return void (tplError = "Claude wartet auf Freigabe");
    await ptyWrite(id, `Fuehre den Workflow mit dem Workflow-Tool aus, scriptPath: ${JSON.stringify(f.path)}. Args: `).catch((e) => (tplError = String(e)));
  };

  // Agent-Tool-Agents als Pseudo-Run mit id "": gleiche Liste und Zeitleiste wie Workflow-Agents
  const solo = $derived<Run>({ id: "", name: "Agents", status: "", started: 0, duration_ms: 0, tokens: 0, phases: [], planned: [], agents: data?.agents ?? [] });
  // Focus belongs to the work tab (workflows and agents), where it was opened.
  const inFocus = $derived(!!focus && tab === "work");
  const focused = $derived.by(() => {
    const r = focus?.run === "" ? solo : data?.runs.find((r) => r.id === focus?.run);
    const a = r?.agents.find((a) => a.id === focus?.agent);
    return r && a ? { r, a } : null;
  });

  async function loadLog() {
    const f = focus,
      sid = data?.session;
    if (!f || !sid) return;
    try {
      const l = await call<Entry[]>("claude_agent_log", { cwd, sid, run: f.run, agent: f.agent });
      if (f !== focus) return;
      // Nur mitscrollen, wenn man schon unten war; sonst springt es beim Lesen weg.
      const el = big ? bigScroller : scroller;
      const stick = !!log && !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      log = l;
      if (stick) requestAnimationFrame(() => el!.scrollTo({ top: el!.scrollHeight }));
    } catch (e) {
      if (f === focus) (log = []), (actionError = String(e));
    }
  }

  function openAgent(r: Run, a: Agent) {
    focus = { run: r.id, agent: a.id };
    actionError = "";
    log = null;
    openGroups = {};
    (big ? bigScroller : scroller)?.scrollTo({ top: 0 });
    loadLog();
  }

  const failed = (a: Agent) => a.state === "error" || a.state === "failed";
  const shows = (a: Agent) => filter === "all" || (filter === "error" ? failed(a) : a.state === filter);
  const bigRun = $derived(data?.runs.find((r) => r.id === big) ?? null);
  // Startet beim ersten Fehler, sonst beim ersten laufenden Agent.
  function openBig(r: Run) {
    big = r.id;
    filter = "all";
    const a = r.agents.find((a) => a.id && failed(a)) ?? r.agents.find((a) => a.id && a.state === "running");
    if (a) openAgent(r, a);
    else (focus = null), (log = null);
  }

  // Springen per claudes Transkript-Ansicht (Ctrl+O, dort "/" Suche): eigenes Scrollen gibt es im
  // Vollbild-Layout nicht. Kurze Pausen, damit die Ansicht steht, bevor die naechste Taste kommt.
  // Ist die Ansicht schon offen, wuerde Ctrl+O sie schliessen und "/…" als Slash-Command im Prompt landen;
  // darum Zustand am Bildschirm pruefen und ohne offene Ansicht nichts tippen.
  // shortcut: Suche nach dem Anfang der ersten Zeile, bei gleich beginnenden Prompts weiter mit n/N.
  async function jump(p: Prompt) {
    const q = p.text.split("\n")[0].slice(0, 30).trim();
    const wait = () => new Promise((r) => setTimeout(r, 150));
    const open = () => screens.get(id)?.().includes("Showing detailed transcript") ?? false;
    actionError = "";
    try {
      if (!open()) {
        await invoke("pty_write", { id, data: "\x0f" });
        // Bis 1,5 s auf den Bildschirmwechsel warten, die Ausgabe kommt asynchron ins xterm.
        for (let i = 0; i < 10 && !open(); i++) await wait();
        if (!open()) return void (actionError = "Transkript-Ansicht von claude ließ sich nicht öffnen.");
      }
      await invoke("pty_write", { id, data: "/" });
      await wait();
      await invoke("pty_write", { id, data: q + "\r" });
    } catch (e) {
      actionError = String(e);
    }
  }

  // With `at`: a file rewritten under the same name (mtime) gets a fresh preview.
  const key = (m: Img) => `${data?.session}:${m.id}:${m.at}`;
  async function full(m: Img): Promise<string | undefined> {
    const id = m.id;
    if (id < 0) return local[-id]?.url;
    const sid = data?.session;
    if (!sid) return;
    const k = key(m);
    let url = cache.get(k);
    if (url) cache.delete(k);
    else url = await call<string>("claude_image", { sid, id }).catch(() => undefined);
    if (!url) return;
    // Zuletzt benutzt ans Ende, aelteste fallen raus
    cache.set(k, url);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return url;
  }

  async function show(m: Img) {
    const id = m.id;
    const k = key(m);
    if (thumbs[k]) return;
    const sid = data?.session;
    let url = id < 0 ? local[-id]?.url : thumbCache.get(k);
    if (!url && sid) {
      url = await call<string>("claude_thumb", { sid, id }).catch(() => undefined);
      if (url) thumbCache.set(k, url);
      else if (sid === data?.session) noThumb[k] = true;
    }
    if (url && sid === data?.session) thumbs[k] = url;
  }

  // Nur an id und Session haengen (shownId, sessionId unten): current ist nach jedem Poll ein neues Objekt,
  // das setzte den Zoom der Lightbox zurueck.
  $effect(() => {
    const i = shownId;
    void sessionId;
    void shownAt;
    fullUrl = undefined;
    const m = untrack(() => current);
    if (m) full(m).then((u) => current?.id === i && (fullUrl = u));
  });

  // Vorschau erst laden, wenn die Kachel in die Naehe der Sicht kommt.
  // One shared observer for all tiles: one per tile cost ~600 observers on every remount of the tab.
  const lazyImg = new Map<Element, Img>();
  let lazyIo: IntersectionObserver | undefined;
  function lazy(node: HTMLElement, m: Img) {
    lazyIo ??= new IntersectionObserver(
      (es) => {
        for (const e of es) {
          const img = e.isIntersecting && lazyImg.get(e.target);
          if (!img) continue;
          show(img);
          lazyIo?.unobserve(e.target);
          lazyImg.delete(e.target);
        }
      },
      { rootMargin: "300px" },
    );
    lazyImg.set(node, m);
    lazyIo.observe(node);
    return {
      destroy: () => {
        lazyIo?.unobserve(node);
        lazyImg.delete(node);
      },
    };
  }

  const tokens = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1)}M`);
  function dur(ms: number) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
  }
  const clock = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const ago = (ms: number) => (ms ? age(new Date(ms).toISOString()) : "");

  // Wie register.tsx der Mod: <50 primary, <80 gelb, sonst rot.
  const HOUR = 3_600_000;
  const WIN = { five_hour: ["5 h", 5 * HOUR], seven_day: ["Woche", 168 * HOUR] } as const;
  const DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const lvl = (p: number) => (p < 50 ? "bg-primary" : p < 80 ? "bg-warning" : "bg-destructive");
  const txt = (p: number) => (p < 50 ? "text-primary" : p < 80 ? "text-warning" : "text-destructive");
  // Prognose in % bei Reset (> 100 = zu schnell); undefined, solange das Fenster nicht laeuft.
  const pace = (used: number, iso: string | undefined, ms: number) => {
    const f = (now - (Date.parse(iso ?? "") - ms)) / ms;
    // Nach dem Reset ohne neue Daten waere die Prognose Unsinn.
    return Number.isNaN(f) || f <= 0 || f > 1 ? undefined : used / f;
  };
  const hm = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const mins = (ms: number) => {
    const m = Math.max(0, Math.floor(ms / 60_000));
    return ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const reset = (iso?: string) => {
    const at = new Date(iso ?? "");
    if (Number.isNaN(at.getTime())) return "";
    const left = at.getTime() - now;
    if (left <= 0) return `Reset erfolgt ${hm(at)}`;
    return left < 24 * HOUR ? `Reset ${hm(at)} · noch ${mins(left)}` : `Reset ${DAYS[at.getDay()]} ${hm(at)}`;
  };
  function details(s: Panel): [string, string][] {
    const t = s.tokens;
    const seen = t.input + t.cacheRead + t.cacheWrite;
    const hours = (now - s.startedAt) / HOUR;
    const rows: [string, unknown][] = [
      ["Modell", s.model && [s.model.replace(/^claude-/, ""), s.effort].filter(Boolean).join(" · ")],
      // Im Abo bleibt cost 0, dann sagt die Zeile nichts.
      ["Kosten", !!s.cost && `$${s.cost.toFixed(2)}${hours > 0.05 ? ` · $${(s.cost / hours).toFixed(2)}/h` : ""}`],
      ["Tokens", !!(seen || t.output) && `${tokens(seen)} in · ${tokens(t.output)} out`],
      ["Cache", !!seen && `${Math.round((t.cacheRead / seen) * 100)}% Hit`],
      ["Dauer", !!s.startedAt && `${mins(now - s.startedAt)} · ${s.turns} Turns`],
    ];
    return rows.filter((r): r is [string, string] => typeof r[1] === "string" && !!r[1]);
  }
  const ACT = { run: "running", ok: "done", err: "error" } as const;
  const resultHead = "text-meta text-muted-foreground mb-1 font-semibold tracking-wide uppercase";

  // Status-Schluessel fuer status(): Laufen schlaegt Fehler schlaegt Abbruch; ohne Agents offen.
  const phaseState = (as: Agent[]) =>
    as.some((a) => a.state === "running")
      ? "running"
      : as.some((a) => a.state === "error" || a.state === "failed")
        ? "error"
        : as.length && as.every((a) => a.state === "done")
          ? "done"
          : as.some((a) => a.state === "aborted")
            ? "aborted"
            : "open";

  const agentDur = (r: Run, a: Agent) => (a.started ? (a.state === "running" ? Date.now() : a.last_at) - a.started : 0);
  // Phasen in Reihenfolge von r.phases, Agents ohne (bekannte) Phase zuletzt; leere Restgruppe faellt weg.
  const groups = (r: Run) =>
    [...new Set([...r.phases, ""])]
      .map((p) => ({ p, agents: r.agents.filter((a) => (p ? a.phase === p : !r.phases.includes(a.phase))) }))
      .filter((g) => g.p || g.agents.length);
  // Erster Start bis letztes Ende der Agents einer Phase
  const span = (as: Agent[]) => {
    const s = as.filter((a) => a.started);
    return s.length ? Math.max(...s.map((a) => (a.state === "running" ? Date.now() : a.last_at))) - Math.min(...s.map((a) => a.started)) : 0;
  };

  // Klick auf "[Image #n]" im Terminal: neuestes passendes Bild; wartet, bis die Aktivitaet geladen ist.
  $effect(() => {
    const r = pasted.req;
    if (r?.id !== id || !data) return;
    const m = imgs.find((m) => m.kind === "paste" && m.label === `Eingefügt #${r.n}`);
    if (m) shown = m.id;
    else actionError = `Bild #${r.n} noch nicht im Transkript.`;
    pasted.req = null;
  });

  const index = $derived(ordered.findIndex((m) => m.id === shown));
  const current = $derived(index < 0 ? null : ordered[index]);
  const shownId = $derived(current?.id);
  const shownAt = $derived(current?.at);
  const sessionId = $derived(data?.session);
  function step(d: number) {
    if (index < 0) return;
    shown = ordered[(index + d + ordered.length) % ordered.length].id;
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else return;
    e.preventDefault();
  }
</script>

<div class="bg-card glow flex h-full flex-col overflow-hidden rounded-xl text-ui ring-1 ring-foreground/5">
  <Tabs
    bind:value={tab}
    tabs={[
      { id: "session", label: "Sitzung" },
      { id: "work", label: "Arbeit", title: "Workflows und Agents", count: (data?.runs.length ?? 0) + (data?.agents.length ?? 0), live: runningRuns + runningAgents },
      { id: "img", label: "Bilder", count: imgs.length },
      { id: "prompts", label: "Prompts", count: data?.prompts.length },
    ]}
  />

  {#if inFocus}
    <!-- Ausserhalb des Scrollbereichs: sticky lag dort ueber breitem Inhalt. -->
    <div class="border-border shrink-0 border-b px-2 py-1.5 text-ui">
      <TextButton class="flex max-w-full gap-0.5" onclick={() => (focus = null)}>
        <ChevronLeftIcon class="size-3.5 shrink-0" /><span class="truncate" title={focused?.r.name}>{focused?.r.name ?? "Zurück"}</span>
      </TextButton>
      {@render agentHead()}
    </div>
  {/if}

  <div bind:this={scroller} class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2 text-ui">
    {#if tab === "work" && !inFocus}
      <!-- Vor der if-Kette: auch ohne laufende Session sichtbar -->
      <section class="border-border/60 @container mb-2 rounded-lg border">
        <div class="flex items-center justify-between pr-2">
          <SectionToggle class={sectionHead} open={!folded.tpl} onclick={() => (folded.tpl = !folded.tpl)}
            >Vorlagen{#if tpls.length}<span class="text-meta">{tpls.length}</span>{/if}</SectionToggle
          >
          {#if !guest}<TextButton class="shrink-0" onclick={() => editTemplate(null)}>+ Neu</TextButton>{/if}
        </div>
        {#if !folded.tpl}
        {#each tpls as x (x.f.path)}
          <div class="border-border/60 flex items-center gap-1.5 border-t px-2 py-1">
            <span class="max-w-32 min-w-10 truncate font-medium" title={[x.f.path, x.description].filter(Boolean).join("\n")}>{x.name}</span>
            <!-- Badges werden bei Platzmangel abgeschnitten, die Knoepfe rechts nie. -->
            <span class="flex min-w-0 shrink items-center gap-1.5 overflow-hidden">
              <span class="text-muted-foreground shrink-0 text-meta">{x.f.scope === "user" ? "Global" : "Projekt"}</span>
              {#if !x.builder}<span class="bg-secondary shrink-0 rounded px-1 text-[10px]" title="Freies Skript: nur starten und löschen">Skript</span>{/if}
              {#if shadowed(x.f.scope, x.name)}<span class="text-warning shrink-0 text-meta" title="Projekt-Vorlage überschreibt die globale gleichen Namens">überschreibt</span>{/if}
            </span>
            <!-- Only where it fits readably; the name's tooltip carries it otherwise -->
            <span class="text-muted-foreground hidden min-w-0 flex-1 truncate @sm:block" title={x.description}>{x.description}</span>
            <span class="flex-1 @sm:hidden"></span>
            <Button
              size="2xs"
              variant="outline"
              disabled={!data?.alive}
              title={data?.alive ? "In die Claude-Sitzung schreiben (Enter selbst drücken)" : "Kein laufendes claude in diesem Terminal-Ordner"}
              onclick={() => startTemplate(x.f)}>Starten</Button
            >
            {#if !guest}
              {@const deletable = /^[A-Za-z0-9_-]+$/.test(x.f.file)}
              <!-- Edit and delete in the ⋯ menu: delete no longer sits right next to start. -->
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}<IconButton {...props} label="Weitere Aktionen"><EllipsisIcon class="size-3.5" /></IconButton>{/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" class={menuContent}>
                    <DropdownMenu.Item
                      class="{menuItem} data-disabled:opacity-50"
                      disabled={!x.builder}
                      title={x.builder ? undefined : "Freies Skript: nur in einer Datei bearbeitbar"}
                      onSelect={() => editTemplate(x.f)}>Bearbeiten …</DropdownMenu.Item
                    >
                    <DropdownMenu.Separator class={menuSeparator} />
                    <DropdownMenu.Item
                      class="{menuItem} text-destructive data-disabled:opacity-50"
                      disabled={!deletable}
                      title={deletable ? undefined : "Dateiname mit Sonderzeichen: nur von Hand löschbar"}
                      onSelect={() => deleteTemplate(x.f, x.name)}>Löschen …</DropdownMenu.Item
                    >
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            {/if}
          </div>
        {:else}
          {#if !tplError}<p class="text-muted-foreground border-border/60 border-t px-2 py-1">Noch keine. Oder Claude sagen: „erstell einen Workflow für … und speicher ihn als Vorlage“.</p>{/if}
        {/each}
        {#if tplError}<p class="text-destructive border-border/60 border-t px-2 py-1">{tplError}</p>{/if}
        {/if}
      </section>
    {/if}
    {#if actionError && !error}
      <p class="text-destructive bg-destructive/10 mb-2 flex items-start gap-2 rounded-md px-2 py-1">
        <span class="min-w-0 flex-1 break-words">{actionError}</span>
        <IconButton size="bare" tone="inherit" label="Meldung schließen" title="" onclick={() => (actionError = "")}>✕</IconButton>
      </p>
    {/if}
    {#if error}
      <p class="text-destructive p-2">{error}</p>
    {:else if !data}
      <Empty>Lade …</Empty>
    {:else if tab === "session"}
      <!-- Limits gelten kontoweit: auch vor der ersten Antwort dieser Session, siehe newest_limits() -->
      {@const lims = (["five_hour", "seven_day"] as const).flatMap((k) => (data!.limits ?? panel?.limits ?? []).filter((l) => l.kind === k).slice(0, 1).map((l) => [k, l] as const))}
      {#if !panel}
        <p class="text-muted-foreground p-2">Noch keine Sitzungsdaten – wartet auf Claude …</p>
      {:else}
        {@const ctx = panel.context}
        {#if ctx.window > 0}
          {@const p = ctx.percent ?? ((ctx.tokens ?? 0) / ctx.window) * 100}
          {@const sub = [
            ctx.tokens === null ? "" : `${tokens(ctx.tokens)} / ${tokens(ctx.window)}`,
            panel.compactLeft === null ? "" : `Compact in ${tokens(Math.max(0, panel.compactLeft))}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          <section class="border-border/60 mb-2 rounded-lg border p-2">
            {@render gauge("Kontext", p, sub, true)}
          </section>
        {/if}
      {/if}
        {#if lims.length}
          <section class="border-border/60 mb-2 divide-y divide-foreground/5 rounded-lg border">
            {#each lims as [k, l] (k)}
              {@const [label, ms] = WIN[k]}
              {@const f = k === "five_hour" ? pace(l.percentUsed, l.resetsAt, ms) : undefined}
              <!-- Nach dem Reset ist das Fenster leer, auch wenn noch keine neue Antwort kam -->
              {@const used = Date.parse(l.resetsAt ?? "") <= now ? 0 : l.percentUsed}
              <div class="p-2">
                {@render gauge(label, used, reset(l.resetsAt))}
                {#if f !== undefined}
                  <div class="mt-0.5 {f > 100 ? 'text-warning' : 'text-muted-foreground'}">
                    {f > 100 ? "◆ zu schnell → 100% vor Reset" : `◇ im Plan → ~${Math.round(f)}% bei Reset`}
                  </div>
                {/if}
              </div>
            {/each}
          </section>
        {/if}
      {#if panel}
        <!-- Live progress above the static stats -->
        {#if panel.active.length}
          <section class="border-border/60 mb-2 rounded-lg border p-2">
            <div class="text-muted-foreground mb-1">Aktiv</div>
            {#each panel.active as a, i (i)}
              {@const [icon, color, text] = status(ACT[a.state])}
              <div class="flex items-center gap-2">
                <span class={color} title={text}>{icon}</span>
                <span class="max-w-24 min-w-10 shrink-0 truncate" title={a.tool}>{a.tool.replace(/^mcp__.*?__/, "")}</span>
                <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-meta" title={a.target}>{a.target}</span>
              </div>
            {/each}
          </section>
        {/if}
        {#if panel.todos.length}
          <section class="border-border/60 mb-2 rounded-lg border p-2">
            <div class="text-muted-foreground mb-1 flex justify-between">
              <span>Todos</span><span class="tabular-nums">{panel.todos.filter((t) => t.status === "completed").length}/{panel.todos.length}</span>
            </div>
            {#each panel.todos as t, i (i)}
              <div class="flex gap-2">
                {#if t.status === "completed"}
                  <span class="text-success">✓</span><span class="text-muted-foreground min-w-0 line-through [overflow-wrap:anywhere]">{t.content}</span>
                {:else if t.status === "in_progress"}
                  <span class="text-primary">◐</span><span class="min-w-0 [overflow-wrap:anywhere]">{t.content}</span>
                {:else}
                  <span class="text-muted-foreground">○</span><span class="min-w-0 [overflow-wrap:anywhere]">{t.content}</span>
                {/if}
              </div>
            {/each}
          </section>
        {/if}
        {@const rows = details(panel)}
        {#if rows.length}
          <section class="border-border/60 mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg border p-2">
            {#each rows as [k, v] (k)}
              <span class="text-muted-foreground">{k}</span><span class="truncate font-medium tabular-nums" title={v}>{v}</span>
            {/each}
          </section>
        {/if}
        {#if data?.modes.length}
          <!-- Plugin-Modi (caveman, ponytail, ...): eigene kleine Karte unter den Details -->
          <section class="border-border/60 mb-2 rounded-lg border p-2">
            <div class="text-muted-foreground mb-1">Modi</div>
            <div class="flex flex-wrap gap-1">
              {#each data.modes as m (m.name)}
                <Badge variant="secondary" class="text-meta font-normal" title="Plugin-Modus {m.name}"
                  >{m.name}{#if m.level}<span class="text-muted-foreground">· {m.level}</span>{/if}</Badge
                >
              {/each}
            </div>
          </section>
        {/if}
      {/if}
    {:else if !data.session}
      <Empty>Keine laufende Claude-Sitzung gefunden.</Empty>
    {:else if inFocus}
      {@render agentLog()}
    {:else if tab === "prompts"}
      {#each [...(data.prompts ?? [])].reverse() as p, i (i)}
        <Row density="roomy" text="md" class="block" title={p.text} aria-label="In claudes Transkript springen: {p.text.slice(0, 80)}" onclick={() => jump(p)}>
          <div class="line-clamp-2 break-words">{p.text}</div>
          <div class="text-muted-foreground text-meta">{ago(p.at)}</div>
        </Row>
      {:else}
        <Empty>Noch keine Prompts in dieser Sitzung.</Empty>
      {/each}
    {:else if tab === "work"}
      {#if data.runs.length}
      <section class="border-border/60 mb-2 rounded-lg border">
        <SectionToggle class={sectionHead} open={!folded.runs} onclick={() => (folded.runs = !folded.runs)}
          >Workflows<span class="text-meta">{data.runs.length}</span></SectionToggle
        >
        {#if !folded.runs}
      {#each data.runs as r (r.id)}
        {@const open = openRuns[r.id] ?? r.status === "running"}
        {@const [icon, color, text] = status(r.status)}
        <div class="border-border/60 border-t">
          <div class="flex items-center">
            <SectionToggle variant="item" class="flex-1" {open} onclick={() => (openRuns[r.id] = !open)}>
              <span class={color} title={text}>{icon}</span>
              <span class="min-w-0 truncate font-medium" title={r.name}>{r.name}</span>
              <span class="text-muted-foreground min-w-0 flex-1 truncate text-right tabular-nums">{text} · {dur(r.duration_ms)} · {tokens(r.tokens)}</span>
            </SectionToggle>
            <Button size="2xs" variant="outline" class="mx-1.5" title="Groß anzeigen: alle Agents mit Verlauf und Ergebnis" onclick={() => openBig(r)}
              >Details</Button
            >
          </div>
          {#if open}{@render phases(r)}{/if}
        </div>
      {/each}
        {/if}
      </section>
      {/if}
      {#if solo.agents.length}
        <section class="border-border/60 mb-2 rounded-lg border">
          <SectionToggle class={sectionHead} open={!folded.agents} onclick={() => (folded.agents = !folded.agents)}
            >Agents<span class="text-meta">{solo.agents.length}</span></SectionToggle
          >
          {#if !folded.agents}{@render phases(solo)}{/if}
        </section>
      {:else if !data.runs.length}
        <Empty>Keine Workflows oder Agents in dieser Sitzung.</Empty>
      {/if}
    {:else if imgs.length}
      {#each imgGroups as [folder, list] (folder)}
        {#if folder}
          <div class="text-meta text-muted-foreground mt-4 mb-2 flex first:mt-0 items-center gap-2" title={folder}>
            <span class="text-foreground min-w-0 truncate font-mono">{folder.split(/[\\/]/).slice(-2).join("/")}</span>
            <span class="shrink-0 tabular-nums">{list.length} Dateien</span>
          </div>
        {/if}
        {#if list.length}
          <div class="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {#each list as m (key(m))}{@render tile(m)}{/each}
          </div>
        {/if}
      {/each}
    {:else}
      <Empty>Noch keine Bilder in dieser Sitzung.</Empty>
    {/if}
  </div>

  <!-- Status unten statt in der Tab-Leiste: dort nahm er den Tabs bei schmalem Panel den Platz. -->
  {#if claudeState || live}
    <div class="border-border text-muted-foreground flex shrink-0 items-center gap-1.5 truncate border-t px-2.5 py-1 text-meta whitespace-nowrap">
      {#if claudeState}
        {@const [i, c, t] = claudeState}
        <span class={c}>{i}</span><span class="text-foreground truncate">{t}</span>
      {:else}
        <span class="bg-primary size-1.5 shrink-0 animate-pulse rounded-full"></span><span class="truncate">{runningRuns ? "Workflow läuft" : runningAgents ? "Agents laufen" : "läuft"}</span>
      {/if}
    </div>
  {/if}
  {#if !guest}<BtwPanel {cwd} {id} sid={data?.alive ? data.session : null} />{/if}
</div>

{#snippet tile(m: Img)}
  <TextButton tone="plain" class="group block min-w-0 {m.missing ? 'opacity-50' : ''}" onclick={() => (shown = m.id)} title={m.label}>
    <div use:lazy={m} class="bg-background/40 group-hover:ring-primary/40 relative aspect-video overflow-hidden rounded-md ring-1 ring-foreground/5">
      {#if m.missing}<span class="text-meta text-muted-foreground grid h-full place-items-center">gelöscht</span>
      {:else if thumbs[key(m)]}<img src={thumbs[key(m)]} alt={m.label} decoding="async" class="aspect-video w-full rounded-md object-cover" />
      {:else if noThumb[key(m)]}<span
          class="text-meta text-muted-foreground grid h-full place-content-center px-1 text-center"
          title="Das Vorschaubild ließ sich nicht erzeugen. Klick öffnet das Original.">Keine Vorschau<span class="opacity-70">Klick zeigt das Original</span></span
        >{/if}
      {#if m.kind === "file"}<span class="bg-secondary text-secondary-foreground text-meta absolute top-1 left-1 rounded px-1.5 leading-4">Datei</span>{/if}
    </div>
    <div class="text-ui mt-1 truncate">{fileName(m)}</div>
    <div class="text-meta text-muted-foreground truncate">{ago(m.at)}</div>
  </TextButton>
{/snippet}

{#snippet agentHead()}
  {#if focused}
    {@const { r, a } = focused}
    {@const [ai, ac, at] = status(a.state)}
    <div class="mt-1 flex items-center gap-2">
      <span class={ac} title={at}>{ai}</span>
      <span class="min-w-0 flex-1 truncate font-medium" title={a.label || a.id}>{a.label || a.id}</span>
    </div>
    <div class="text-muted-foreground mt-0.5 truncate pl-5 tabular-nums">
      {[at, a.phase, dur(agentDur(r, a)), `${a.tool_calls} Tools`, a.tokens ? tokens(a.tokens) : ""].filter(Boolean).join(" · ")}
    </div>
  {/if}
{/snippet}

{#snippet agentLog()}
  {#if !focused}
    <Empty>Agent nicht mehr in der Liste.</Empty>
  {:else if !log}
    <Empty>Lade Verlauf …</Empty>
  {:else}
    {@const a = focused.a}
    {@const cs = chunks(log)}
    <!-- Without a journal result, a finished agent's closing text is its result. -->
    {@const fin = !a.result && a.state !== "running" && cs.length && !cs[cs.length - 1].tools ? cs.length - 1 : -1}
    <ol class="space-y-1">
      {#each cs as c, i (i)}
        <li>
          {#if !c.tools}
            {@const e = c.e}
            {#if e.kind === "prompt"}
              <details class="bg-secondary/50 rounded-md px-2 py-1">
                <summary class="text-muted-foreground cursor-pointer">Auftrag</summary>
                <pre class="mt-1 max-h-64 overflow-auto font-mono text-meta whitespace-pre-wrap">{e.body}</pre>
              </details>
            {:else}
              {#if i === fin}<div class="{resultHead} mt-2">Ergebnis</div>{/if}
              <!-- Breite Tabellen/Code scrollen hier, nicht das ganze Panel unter die Kopfzeile. -->
              <div class="border-primary/40 min-w-0 overflow-x-auto border-l-2 py-0.5 pl-2"><Markdown text={e.body} /></div>
            {/if}
          {:else if c.tools.length === 1}
            {@render toolRow(c.tools[0], a)}
          {:else}
            {@const err = c.tools.filter((e) => e.error).length}
            <!-- Laufender Agent: letzte Gruppe offen, damit man sieht, was gerade passiert. -->
            {@const op = openGroups[i] ?? (a.state === "running" && i === cs.length - 1)}
            <details class="group/tools rounded-md" open={op}>
              <summary
                onclick={(ev) => {
                  ev.preventDefault();
                  openGroups[i] = !op;
                }}
                class="text-muted-foreground hover:bg-accent/40 flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-0.5 text-meta">
                <ChevronRightIcon class="size-3 shrink-0 group-open/tools:rotate-90" />
                <span class="text-foreground shrink-0 tabular-nums">{c.tools.length} Tools</span>
                {#if err}<span class="text-destructive shrink-0">{err} ✕</span>{/if}
                <span class="min-w-0 truncate font-mono" title={tally(c.tools)}>{tally(c.tools)}</span>
              </summary>
              <ol class="border-border/60 ml-2.5 border-l pl-1">
                {#each c.tools as e, j (j)}<li>{@render toolRow(e, a)}</li>{/each}
              </ol>
            </details>
          {/if}
        </li>
      {:else}
        <li class="text-muted-foreground p-2">Kein Verlauf gefunden.</li>
      {/each}
    </ol>
    {#if a.result}
      <div class="border-border/60 mt-2 rounded-lg border p-2">
        <div class={resultHead}>Ergebnis</div>
        <div class="min-w-0 overflow-x-auto"><Markdown text={a.result} /></div>
      </div>
    {/if}
  {/if}
{/snippet}

{#snippet toolRow(e: Entry, a: Agent)}
  {@const [si, sc, st] =
    e.output !== null
      ? e.error
        ? ["✕", "text-destructive", "Fehler"]
        : ["✓", "text-success", "fertig"]
      : a.state === "running"
        ? ["◐", "text-primary animate-pulse", "läuft"]
        : ["⊘", "text-muted-foreground", "ohne Ergebnis"]}
  <details class="hover:bg-accent/40 open:bg-accent/30 rounded-md">
    <summary class="flex cursor-pointer list-none items-center gap-1.5 px-1 py-0.5 font-mono text-meta">
      <span class="text-muted-foreground shrink-0 tabular-nums">{e.at ? clock(e.at) : ""}</span>
      <span class="shrink-0 {sc}" title={st}>{si}</span>
      <span class="text-foreground shrink-0">{e.tool}</span>
      <span class="text-muted-foreground min-w-0 truncate" title={e.summary}>{e.summary}</span>
    </summary>
    <div class="space-y-1 px-1 pb-1.5">
      <pre class="bg-background/60 max-h-48 overflow-auto rounded p-1.5 font-mono text-meta whitespace-pre-wrap">{e.body}</pre>
      {#if e.output !== null}
        <pre
          class="bg-background/60 max-h-64 overflow-auto rounded p-1.5 font-mono text-meta whitespace-pre-wrap {e.error
            ? 'text-destructive'
            : ''}">{e.output || "(leer)"}</pre>
      {/if}
    </div>
  </details>
{/snippet}

{#snippet phases(r: Run, dlg = false)}
  {#each groups(r) as g (g.p)}
    {@const st = phaseState(g.agents)}
    {@const ok = `${r.id}:${g.p}`}
    {@const open = !r.phases.length || (openPhases[ok] ?? (st === "running" || st === "error"))}
    <!-- Im Dialog filtert der Status; die Kopfzeile zaehlt trotzdem die ganze Phase. -->
    {@const shown = dlg ? g.agents.filter(shows) : g.agents}
    {#if r.phases.length && (shown.length || filter === "all" || !dlg)}
      {@const [pi, pc, pt] = status(st)}
      {@const n = g.agents.filter((a) => a.state === "done").length}
      {@const err = g.agents.filter(failed).length}
      <SectionToggle
        variant="item"
        class="border-border/60 bg-secondary/30 rounded-none border-t {dlg ? 'sticky top-0 z-10 backdrop-blur' : ''}"
        {open}
        onclick={() => (openPhases[ok] = !open)}
      >
        <span class={pc} title={pt}>{pi}</span>
        <span class="min-w-16 flex-1 truncate font-medium {g.p ? '' : 'text-muted-foreground'}" title={g.p}>{g.p || "Ohne Phase"}</span>
        <span class="text-muted-foreground min-w-0 truncate tabular-nums"
          >{pt} · {n}/{Math.max(g.agents.length, r.planned[r.phases.indexOf(g.p)] ?? 0)}{#if err}<span class="text-destructive"> · {err} ✕</span>{/if}{#if span(g.agents)} · {dur(span(g.agents))}{/if}{#if g.agents.some((a) => a.tokens)} · {tokens(
              g.agents.reduce((t, a) => t + a.tokens, 0),
            )}{/if}</span
        >
      </SectionToggle>
    {/if}
    {#if open}
    <ul class="border-border/60 {shown.length ? 'border-t' : ''}">
      {#each shown as a, i (i)}
        {@const [ai, ac, at] = status(a.state)}
        {@const last = a.steps.at(-1)}
        {@const pk = `${r.id}:${a.id || g.p + i}`}
        <li>
          <div class="flex items-start">
            <Row
              indent={!!r.phases.length}
              flush
              text="md"
              selected={!!(dlg && a.id && a.id === focus?.agent)}
              class="group/agent block flex-1 pr-2 disabled:opacity-100"
              disabled={!a.id}
              title={a.id ? "Verlauf anzeigen" : undefined}
              onclick={() => openAgent(r, a)}
            >
              <div class="flex items-center gap-2">
                <span class={ac} title={at}>{ai}</span>
                <span class="min-w-16 flex-1 truncate" title={a.label || a.id}>{a.label || a.id}</span>
                <span class="text-muted-foreground min-w-0 truncate tabular-nums"
                  >{dur(agentDur(r, a))}{#if a.tokens} · {tokens(a.tokens)}{/if}</span
                >
                {#if a.id}<ChevronRightIcon class="text-muted-foreground size-3.5 shrink-0 opacity-0 group-hover/agent:opacity-100" />{/if}
              </div>
              {#if last}
                <div class="text-muted-foreground truncate pl-5 font-mono text-meta" title="{last.tool} {last.summary}">{last.tool} {last.summary}</div>
              {/if}
            </Row>
            {#if a.prompt}
              <!-- Eigener Button neben dem Agent-Button (nicht darin): klappt nur den Prompt -->
              <TextButton
                size="sm"
                class="shrink-0 gap-0.5 px-1.5 py-1"
                aria-expanded={!!openPrompts[pk]}
                onclick={() => (openPrompts[pk] = !openPrompts[pk])}
                >Prompt <ChevronRightIcon class="size-3 transition-transform {openPrompts[pk] ? 'rotate-90' : ''}" /></TextButton
              >
            {/if}
          </div>
          {#if a.prompt && openPrompts[pk]}
            <div class="bg-secondary/50 mx-2 mb-1 max-h-64 min-w-0 overflow-auto rounded-md px-2 py-1"><Markdown text={a.prompt} /></div>
          {/if}
        </li>
      {/each}
    </ul>
    {/if}
  {/each}
{/snippet}

{#snippet gauge(label: string, p: number, sub: string, big = false)}
  <div class="flex items-baseline justify-between">
    <span class="text-muted-foreground">{label}</span><span class="{big ? 'text-title' : 'text-body'} font-semibold tabular-nums {txt(p)}">{Math.round(p)} %</span>
  </div>
  <div class="my-1 h-1 overflow-hidden rounded-full bg-foreground/5">
    <div class="h-full rounded-full {lvl(p)}" style:width="{Math.min(100, Math.max(0, p))}%"></div>
  </div>
  {#if sub}<div class="text-muted-foreground truncate">{sub}</div>{/if}
{/snippet}

<WorkflowDialog bind:open={wfOpen} {cwd} entry={wfEntry} taken={templates} onsaved={loadTemplates} />

<Dialog.Root open={!!bigRun} onOpenChange={(o) => !o && ((big = null), (focus = null), (log = null))}>
  <Dialog.Content class="flex h-[85vh] flex-col gap-3 text-ui sm:max-w-[min(92vw,1400px)]">
    {#if bigRun}
      {@const r = bigRun}
      {@const [icon, color, text] = status(r.status)}
      {@const cnt = (k: string) => r.agents.filter((a) => (k === "error" ? failed(a) : a.state === k)).length}
      <div class="pr-8">
        <Dialog.Title class="flex items-center gap-2 text-title">
          <span class={color} title={text}>{icon}</span><span class="min-w-0 truncate" title={r.name}>{r.name}</span>
        </Dialog.Title>
        <div class="text-muted-foreground mt-0.5 tabular-nums">{text} · {dur(r.duration_ms)} · {tokens(r.tokens)} · {cnt("done")}/{r.agents.length} Agents fertig</div>
        <!-- Segmentierter Fortschritt: fertig / Fehler / laeuft -->
        <div class="mt-2 flex h-1 overflow-hidden rounded-full bg-foreground/5">
          {#each [["done", "bg-success"], ["error", "bg-destructive"], ["running", "bg-primary animate-pulse"]] as [k, c] (k)}
            <div class={c} style:width="{(cnt(k) / Math.max(1, r.agents.length)) * 100}%"></div>
          {/each}
        </div>
        <div class="mt-2 flex">
          <Segmented
            value={filter}
            options={[
              [`Alle ${r.agents.length}`, "all"],
              [`Laufend ${cnt("running")}`, "running"],
              [`Fehler ${cnt("error")}`, "error"],
            ] as const}
            onchange={(v) => (filter = v)}
          />
        </div>
      </div>
      <div class="border-border/60 grid min-h-0 flex-1 grid-cols-[minmax(260px,2fr)_3fr] overflow-hidden rounded-lg border">
        <div class="border-border/60 min-h-0 overflow-y-auto border-r">
          {#if r.agents.some(shows)}{@render phases(r, true)}{:else}<Empty>Keine Agents mit diesem Status.</Empty>{/if}
        </div>
        <div class="flex min-h-0 min-w-0 flex-col">
          {#if focus}
            <div class="border-border/60 shrink-0 border-b px-2 pb-1.5">{@render agentHead()}</div>
            <div bind:this={bigScroller} class="min-h-0 flex-1 overflow-y-auto p-2">{@render agentLog()}</div>
          {:else}
            <Empty>Agent links auswählen.</Empty>
          {/if}
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={current !== null} onOpenChange={(o) => !o && (shown = null)}>
  <Dialog.Content class="max-h-[90vh] sm:max-w-[min(90vw,1200px)]" {onkeydown}>
    {#if current}
      <Dialog.Title class="sr-only">{current.label}</Dialog.Title>
      <div class="flex min-h-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Vorheriges Bild" onclick={() => step(-1)}
          ><ChevronLeftIcon class="size-5" /></Button
        >
        <div class="flex min-h-0 min-w-0 flex-1 justify-center">
          {#if current.missing}
            <p class="text-muted-foreground p-8">Datei gelöscht.</p>
          {:else if fullUrl}
            <ZoomImage src={fullUrl} alt={current.label} onswipe={step} />
          {:else}
            <p class="text-muted-foreground p-8">Lade …</p>
          {/if}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Nächstes Bild" onclick={() => step(1)}
          ><ChevronRightIcon class="size-5" /></Button
        >
      </div>
      <div class="text-muted-foreground flex items-center gap-2 text-ui">
        <span class="min-w-0 flex-1 truncate tabular-nums"
          >{index + 1} / {ordered.length} · {current.label} · {current.at ? clock(current.at) : ""}</span
        >
        {#if current.kind === "read" || current.kind === "file"}
          <TextButton underline class="shrink-0" onclick={() => navigator.clipboard.writeText(current.label)}
            >Pfad kopieren</TextButton
          >
        {/if}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
