// Debugger for .NET start targets: builds the project (dbg_build), starts netcoredbg (run by lsp.rs as the server
// "netcoredbg", fetched on first use by debug.rs) and speaks DAP with it. One session per project, shown in DebugPane;
// breakpoints per file (editor gutter, breakpoints.ts), kept in localStorage "breakpoints:<repo>".
// Starting runs project code: only from a click or a key, like runStart.
import { t } from "./i18n.ts";
import { Channel, invoke } from "@tauri-apps/api/core";
import { DEBUG, activate, groupOf } from "./dock.ts";
import { editor, open, setLayout, togglePanel } from "./editor.svelte.ts";
import { clip, frameName, pickFrame, toAbs, toRel, type Frame } from "./debug.logic.ts";
import type { RunConfig } from "./run.logic.ts";

type Out = { t: "msg"; m: string } | { t: "exit"; code: number | null; err: string };
export type Var = { name: string; value: string; type: string; ref: number; kids: Var[] | null; open: boolean };
/** build: dotnet build, start: adapter starting, run: program runs, pause: stopped at a line, end: over. */
export type Phase = "build" | "start" | "run" | "pause" | "end";
type Pending = { ok: (body: any) => void; fail: (e: Error) => void };

const SERVER = "netcoredbg";
const MAX_OUT = 200_000;
const MAX_VARS = 300;

export class Session {
  readonly label: string;
  phase = $state<Phase>("build");
  /** Why it stopped: "breakpoint", "step", "exception", "pause", ... */
  reason = $state("");
  frames = $state.raw<Frame[]>([]);
  /** id of the frame whose variables are shown. */
  frame = $state<number | null>(null);
  /** Scopes of that frame, each expandable. */
  vars = $state<Var[]>([]);
  out = $state("");
  thread = 0;
  seq = 0;
  pending = new Map<number, Pending>();
  queue: Promise<unknown> = Promise.resolve();
  inited: () => void = () => {};
  constructor(label: string) {
    this.label = label;
  }
}

class RepoDebug {
  session = $state.raw<Session | null>(null);
  /** Where the debugger stopped (shown frame), for the editor's arrow. */
  at = $state.raw<{ path: string; line: number } | null>(null);
  /** Repo-relative path -> breakpoint lines (1-based). */
  bps: Record<string, number[]>;
  /** Last breakpoints set from outside an editor (Claude's tool): an open editor of that file takes them over. */
  pushed = $state.raw<{ path: string; lines: number[] } | null>(null);
  constructor(bps: Record<string, number[]>) {
    this.bps = bps;
  }
}

const store = new Map<string, RepoDebug>();

function load(repo: string): Record<string, number[]> {
  try {
    const v = JSON.parse(localStorage.getItem(`breakpoints:${repo}`) ?? "{}");
    const out: Record<string, number[]> = {};
    for (const [k, l] of Object.entries(v ?? {})) if (Array.isArray(l)) out[k] = l.filter((n) => Number.isInteger(n) && n > 0);
    return out;
  } catch {
    return {};
  }
}

export function debug(repo: string): RepoDebug {
  let d = store.get(repo);
  if (!d) store.set(repo, (d = new RepoDebug(load(repo))));
  return d;
}

const live = (s: Session | null | undefined): s is Session => !!s && s.phase !== "end";

const log = (s: Session, text: string) => void (s.out = clip(s.out + text, MAX_OUT));

function req(repo: string, s: Session, command: string, args: object = {}): Promise<any> {
  if (s.phase === "end") return Promise.reject(new Error(t("Debugger beendet")));
  const seq = ++s.seq;
  const msg = JSON.stringify({ seq, type: "request", command, arguments: args });
  return new Promise((ok, fail) => {
    s.pending.set(seq, { ok, fail });
    s.queue = s.queue
      .then(() => invoke("lsp_send", { repo, server: SERVER, msg }))
      .catch((e) => {
        s.pending.delete(seq);
        fail(new Error(String(e)));
      });
  });
}

/** Breakpoints of a file changed in its editor: keep them and tell a running debugger. */
export function setBreakpoints(repo: string, path: string, lines: number[]): void {
  const d = debug(repo);
  if (lines.length) d.bps[path] = lines;
  else delete d.bps[path];
  try {
    localStorage.setItem(`breakpoints:${repo}`, JSON.stringify(d.bps));
  } catch {
    // Storage full or blocked: breakpoints only last for this session.
  }
  const s = d.session;
  if (s && (s.phase === "run" || s.phase === "pause")) void sendBps(repo, s, path, lines).catch(() => {});
}

const sendBps = (repo: string, s: Session, path: string, lines: number[]) =>
  req(repo, s, "setBreakpoints", { source: { path: toAbs(repo, path) }, breakpoints: lines.map((line) => ({ line })) });

/** Show the debug panel (beside the output, else below the editor). */
export function showDebug(repo: string): void {
  const s = editor(repo);
  const g = groupOf(s.layout, DEBUG);
  if (!g) togglePanel(repo, "debug");
  else if (g.active !== DEBUG) setLayout(repo, activate(s.layout, DEBUG));
}

/** Build and debug the .NET start target. Runs project code: only from a click or a key. */
export async function debugStart(repo: string, cfg: RunConfig | null): Promise<void> {
  const d = debug(repo);
  if (live(d.session)) return showDebug(repo);
  if (cfg?.target.kind !== "dotnet") {
    editor(repo).error = t("Debuggen geht bisher nur mit .NET-Startzielen (startbare .csproj).");
    return;
  }
  const s = new Session(cfg.label);
  d.session = s;
  d.at = null;
  showDebug(repo);
  const inited = new Promise<void>((r) => (s.inited = r));
  // A function, not s.phase inline: TypeScript would narrow it across the awaits.
  const ended = () => s.phase === "end";
  try {
    log(s, t("Baue {label} …", { label: cfg.label }) + "\n");
    const dll = await invoke<string>("dbg_build", { repo, dir: cfg.dir });
    if (ended()) return;
    s.phase = "start";
    log(s, t("Starte den Debugger (netcoredbg, beim ersten Mal wird er heruntergeladen) …") + "\n");
    const ch = new Channel<Out>();
    ch.onmessage = (o) => (o.t === "msg" ? onMsg(repo, s, o.m) : onExit(repo, s, o));
    await invoke("lsp_start", { repo, server: SERVER, on: ch });
    // Stopped while the adapter started: it would keep running orphaned.
    if (ended()) return void invoke("lsp_stop", { repo, server: SERVER }).catch(() => {});
    await req(repo, s, "initialize", {
      clientID: "atelier",
      clientName: "L'Atelier de Claude",
      adapterID: "coreclr",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsVariableType: true,
    });
    // The response may only come after configurationDone.
    const launched = req(repo, s, "launch", {
      name: cfg.label,
      type: "coreclr",
      request: "launch",
      program: dll,
      args: [],
      cwd: cfg.dir ? toAbs(repo, cfg.dir) : repo,
      console: "internalConsole",
      stopAtEntry: false,
      justMyCode: true,
    });
    await inited;
    for (const [path, lines] of Object.entries(d.bps)) await sendBps(repo, s, path, lines);
    await req(repo, s, "setExceptionBreakpoints", { filters: [] });
    await req(repo, s, "configurationDone");
    await launched;
    if (s.phase === "start") s.phase = "run";
  } catch (e) {
    // Compiler lines: project-relative, without MSBuild's " [/abs/Lab.csproj]" tail.
    const text = String(e).replace(/^Error: /, "").replaceAll(`${repo}/`, "").replace(/ \[[^\]\n]*proj\]/g, "");
    if (s.phase !== "end") log(s, `\n${text}\n`);
    finish(repo, s);
  }
}

function onMsg(repo: string, s: Session, raw: string) {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (m.type === "response") {
    const p = s.pending.get(m.request_seq);
    if (!p) return;
    s.pending.delete(m.request_seq);
    if (m.success) p.ok(m.body ?? {});
    else p.fail(new Error(m.message || t("{command} fehlgeschlagen", { command: m.command })));
    return;
  }
  // Reverse requests (runInTerminal) were not offered in initialize.
  if (m.type === "request") {
    const msg = JSON.stringify({ seq: ++s.seq, type: "response", request_seq: m.seq, command: m.command, success: false, message: "nicht unterstützt" });
    s.queue = s.queue.then(() => invoke("lsp_send", { repo, server: SERVER, msg })).catch(() => {});
    return;
  }
  if (m.type !== "event") return;
  const b = m.body ?? {};
  if (m.event === "initialized") s.inited();
  else if (m.event === "output" && b.category !== "telemetry" && typeof b.output === "string") log(s, b.output);
  else if (m.event === "stopped") void stopped(repo, s, b);
  else if (m.event === "continued") resumed(repo, s);
  else if (m.event === "exited") log(s, "\n" + t("Programm beendet (Code {code}).", { code: b.exitCode }) + "\n");
  else if (m.event === "terminated") finish(repo, s);
}

function onExit(repo: string, s: Session, o: { code: number | null; err: string }) {
  // Killed by finish() (code null) or a clean end: nothing to report.
  if (s.phase !== "end" && o.code) log(s, `\n${o.err}\n`);
  finish(repo, s);
}

/** Session over: drop pending requests, the arrow, and the adapter process (with the program). */
function finish(repo: string, s: Session) {
  if (s.phase === "end") return;
  s.phase = "end";
  s.frames = [];
  s.vars = [];
  s.frame = null;
  for (const p of s.pending.values()) p.fail(new Error(t("Debugger beendet")));
  s.pending.clear();
  s.inited();
  const d = debug(repo);
  if (d.session !== s) return;
  d.at = null;
  void invoke("lsp_stop", { repo, server: SERVER }).catch(() => {});
}

function resumed(repo: string, s: Session) {
  if (s.phase !== "pause") return;
  s.phase = "run";
  s.frames = [];
  s.vars = [];
  s.frame = null;
  debug(repo).at = null;
}

async function stopped(repo: string, s: Session, b: { reason?: string; threadId?: number; text?: string; description?: string }) {
  s.phase = "pause";
  s.reason = b.reason ?? "";
  if (b.reason === "exception") log(s, "\n" + t("Ausnahme: {text}", { text: b.text ?? b.description ?? "" }) + "\n");
  try {
    s.thread = b.threadId ?? (s.thread || ((await req(repo, s, "threads")).threads?.[0]?.id ?? 0));
    const st = await req(repo, s, "stackTrace", { threadId: s.thread, startFrame: 0, levels: 100 });
    if (s.phase !== "pause") return;
    s.frames = (st.stackFrames ?? []).map((f: any) => ({
      id: f.id,
      name: frameName(f.name ?? ""),
      path: f.source?.path ? toRel(repo, f.source.path) : null,
      line: f.line,
    }));
    const f = pickFrame(s.frames);
    if (f) await selectFrame(repo, f);
  } catch (e) {
    if (s.phase === "pause") log(s, `\n${String(e).replace(/^Error: /, "")}\n`);
  }
}

const isRel = (p: string) => !/^([a-z]:)?\//i.test(p);

/** Show a frame: jump to its line (inside the project) and load its variables. */
export async function selectFrame(repo: string, f: Frame): Promise<void> {
  const d = debug(repo);
  const s = d.session;
  if (!s || s.phase !== "pause") return;
  s.frame = f.id;
  d.at = f.path && isRel(f.path) ? { path: f.path, line: f.line } : null;
  if (d.at) void open(repo, d.at.path, d.at.line);
  try {
    const sc = await req(repo, s, "scopes", { frameId: f.id });
    if (s.frame !== f.id || s.phase !== "pause") return;
    s.vars = (sc.scopes ?? []).map((x: any) => ({ name: x.name, value: "", type: "", ref: x.variablesReference, kids: null, open: false }));
    if (s.vars[0]) await expand(repo, s.vars[0]);
  } catch (e) {
    log(s, `\n${String(e).replace(/^Error: /, "")}\n`);
  }
}

/** Open or close a variable (scope, object, array); its children load once per stop. */
export async function expand(repo: string, v: Var): Promise<void> {
  const s = debug(repo).session;
  if (!s || s.phase !== "pause") return;
  if (v.open || v.ref <= 0) return void (v.open = false);
  if (v.kids === null) {
    const frame = s.frame;
    const r = await req(repo, s, "variables", { variablesReference: v.ref }).catch(() => null);
    if (!r || s.frame !== frame || s.phase !== "pause") return;
    const all: any[] = r.variables ?? [];
    const kids: Var[] = all.slice(0, MAX_VARS).map((x) => ({ name: x.name, value: x.value ?? "", type: x.type ?? "", ref: x.variablesReference ?? 0, kids: null, open: false }));
    if (all.length > MAX_VARS) kids.push({ name: "…", value: t("{n} weitere", { n: all.length - MAX_VARS }), type: "", ref: 0, kids: null, open: false });
    v.kids = kids;
  }
  v.open = true;
}

/** Continue, step over/into/out, pause. */
export async function debugStep(repo: string, how: "continue" | "next" | "stepIn" | "stepOut" | "pause"): Promise<void> {
  const s = debug(repo).session;
  if (!s || (how === "pause" ? s.phase !== "run" : s.phase !== "pause")) return;
  try {
    if (how === "pause") {
      const t = s.thread || ((await req(repo, s, "threads")).threads?.[0]?.id ?? 0);
      await req(repo, s, "pause", { threadId: t });
      return;
    }
    const sent = req(repo, s, how, { threadId: s.thread });
    // No "continued" event follows a step or continue request.
    resumed(repo, s);
    await sent;
  } catch (e) {
    log(s, `\n${String(e).replace(/^Error: /, "")}\n`);
  }
}

/** End the session and the program. */
export async function debugStop(repo: string): Promise<void> {
  const s = store.get(repo)?.session;
  if (!live(s)) return;
  // Before disconnecting: the adapter's "terminated" may end the session first.
  log(s, "\n" + t("Gestoppt.") + "\n");
  if (s.phase === "run" || s.phase === "pause") {
    const bye = req(repo, s, "disconnect", { terminateDebuggee: true }).catch(() => {});
    await Promise.race([bye, new Promise((r) => setTimeout(r, 1500))]);
  }
  finish(repo, s);
}

// ---------- For Claude's tool "debugger" (agent.svelte.ts) ----------

const paused = (repo: string): Session => {
  const s = debug(repo).session;
  if (!s || s.phase !== "pause") throw new Error(t("Der Debugger hält gerade nicht an."));
  return s;
};

/** Evaluate an expression in the shown frame: value, type and a ref to expand. */
export async function debugEval(repo: string, expression: string): Promise<string> {
  const s = paused(repo);
  const r = await req(repo, s, "evaluate", { expression, frameId: s.frame ?? undefined, context: "repl" });
  return `${r.result ?? ""}${r.type ? `: ${r.type}` : ""}${r.variablesReference > 0 ? ` [ref ${r.variablesReference}]` : ""}`;
}

/** Children of a variable or evaluation result (variablesReference). */
export async function debugVars(repo: string, ref: number): Promise<Var[]> {
  const r = await req(repo, paused(repo), "variables", { variablesReference: ref });
  return (r.variables ?? []).slice(0, MAX_VARS).map((x: any) => ({ name: x.name, value: x.value ?? "", type: x.type ?? "", ref: x.variablesReference ?? 0, kids: null, open: false }));
}

/** Breakpoints of a file from outside the editor; an open editor of the file shows them too. */
export function pushBreakpoints(repo: string, path: string, lines: number[]): void {
  setBreakpoints(repo, path, lines);
  debug(repo).pushed = { path, lines };
}
