// Run-Leiste je Projekt: erkannte Startziele und hoechstens ein Prozess (PTY). Lebt auf Modulebene wie editor():
// RunPane wird beim Andocken neu gemountet, Prozess und Ausgabe bleiben. Die Auswahl steht im Editor-Store (run).
// Invariante: laeuft etwas, ist das Panel RUN im Layout (runStart dockt es an, Schliessen/Zuruecksetzen stoppt).
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { RUN, activate, groupOf, mainGroup, splitAt } from "./dock.ts";
import { fs, ptyClose, ptyWrite, runMissing, runStart as startCmd } from "./files.ts";
import { confirm } from "./confirm.svelte.ts";
import { serverUrl } from "./editor.logic.ts";
import { configs, customConfig, markers, pickDefault, profileOf, scan, tailText, type RunConfig } from "./run.logic.ts";
import { codeBlock, failuresReport } from "./testing.logic.ts";
import { editor, peek, setLayout } from "./editor.svelte.ts";
import { failedItems } from "./testing.svelte.ts";

export type Run = { cfg: RunConfig; id: string; state: "running" | "exited" | "idle"; exit: number | null; started: number; url: string };
type Sink = (b: Uint8Array) => void;

export class RepoRun {
  readonly repo: string;
  configs = $state.raw<RunConfig[]>([]);
  /** Letzter oder laufender Prozess; idle = vom User gestoppt. */
  current = $state.raw<Run | null>(null);
  constructor(repo: string) {
    this.repo = repo;
  }
  get selected(): string | null {
    return editor(this.repo).run;
  }
}

const store = new Map<string, RepoRun>();
/** Erkennung je Projekt (einmal je Sitzung); laeuft sie noch, wartet runStart darauf. */
const detected = new Map<string, Promise<void>>();

/**
 * Rohe Ausgabe fuer das Replay beim Mount von RunPane, nicht reaktiv. ponytail: 1 MB, aelteste Chunks fallen raus.
 * tail = letzte 4 KB ohne Escape-Sequenzen fuer die URL-Erkennung, fixed = "Local"-Adresse gefunden.
 */
type Buf = { id: string; chunks: Uint8Array[]; bytes: number; sink: Sink | null; tail: string; fixed: boolean; off: Promise<UnlistenFn>[] };
const bufs = new Map<string, Buf>();
const MAX_BYTES = 1 << 20;
const TAIL_BYTES = 1 << 16;
// RIS: setzt das angehaengte xterm vor einem neuen Lauf zurueck.
const RESET = new TextEncoder().encode("\x1bc");

function buf(repo: string): Buf {
  let b = bufs.get(repo);
  if (!b) bufs.set(repo, (b = { id: "", chunks: [], bytes: 0, sink: null, tail: "", fixed: false, off: [] }));
  return b;
}

function push(b: Buf, bytes: Uint8Array) {
  b.chunks.push(bytes);
  b.bytes += bytes.length;
  while (b.bytes > MAX_BYTES && b.chunks.length > 1) b.bytes -= b.chunks.shift()!.length;
  b.sink?.(bytes);
}

/** Zustand des Projekts, pro Repo immer dasselbe Objekt. */
export function run(repo: string): RepoRun {
  let r = store.get(repo);
  if (!r) store.set(repo, (r = new RepoRun(repo)));
  return r;
}

/** Startziele erkennen (einmal je Sitzung). Liest nur, startet nichts. */
export function detect(repo: string): Promise<void> {
  let p = detected.get(repo);
  if (!p) {
    p = scanConfigs(repo).catch((e) => {
      detected.delete(repo);
      editor(repo).error = String(e);
    });
    detected.set(repo, p);
  }
  return p;
}

/**
 * Erkannte Startziele verwerfen (Projekt geschlossen). Mit path nur, wenn er eine Marker-Datei ist (gespeichert):
 * dann gleich neu erkennen, sonst tauchen neue Scripts/Projekte erst nach einem Neustart auf.
 */
export function redetect(repo: string, path?: string): void {
  if (path !== undefined && !markers([path]).length) return;
  detected.delete(repo);
  if (path !== undefined) void detect(repo);
}

async function scanConfigs(repo: string) {
  const files = await fs.files(repo);
  const ms = markers(files);
  const texts = await Promise.all(ms.map((f) => fs.read(repo, f).then((t) => t.content, () => "")));
  run(repo).configs = configs(files, Object.fromEntries(ms.map((f, i) => [f, texts[i]])));
}

/** Erkannte plus eigene Startziele. */
export const allConfigs = (repo: string) => [...run(repo).configs, ...editor(repo).custom.map(customConfig)];

/** Gewaehltes Ziel bzw. die Vorauswahl. */
export const chosen = (repo: string) => pickDefault(allConfigs(repo), editor(repo).run, editor(repo).active);

/** Sink fuer RunPane setzen (null = abgehaengt); liefert die bisherige Ausgabe zum Nachspielen. */
export function attach(repo: string, sink: Sink | null): Uint8Array[] {
  const b = buf(repo);
  b.sink = sink;
  return [...b.chunks];
}

/** Letzte n Zeilen der Ausgabe als Markdown fuer den Prompt, mit Befehl und Status; liest den Puffer, braucht kein RunPane. */
export function tailOutput(repo: string, n = 200): string {
  const cur = store.get(repo)?.current;
  if (!cur) return "";
  // Nur die letzten 64 KiB dekodieren: 1 MiB Dauer-Log kostete ~4 ms je Push, so ~0,25 ms.
  const cs = bufs.get(repo)?.chunks ?? [];
  let i = cs.length;
  let sum = 0;
  while (i > 0 && sum < TAIL_BYTES) sum += cs[--i].length;
  const parts = cs.slice(i);
  if (sum > TAIL_BYTES) parts[0] = parts[0].subarray(sum - TAIL_BYTES);
  const dec = new TextDecoder();
  let text = parts.map((c) => dec.decode(c, { stream: true })).join("") + dec.decode();
  if (sum > TAIL_BYTES) text = text.slice(text.indexOf("\n") + 1); // angeschnittene erste Zeile weg
  const st = cur.state === "running" ? "läuft" : cur.state === "idle" ? "gestoppt" : cur.exit === null ? "beendet" : `exit ${cur.exit}`;
  return `Ausgabe von \`${cur.cfg.label}\` (${st}), letzte ${n} Zeilen:\n${codeBlock(tailText(text, n))}\n`;
}

const runTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Run-Ausgabe und rote Tests fuer das MCP-Tool run_state (ide.rs). Trailing 1 s, der Timer wird bei neuen Chunks nicht
 * neu gestartet: bei Dauer-Log hoechstens ein invoke je Sekunde. Projekt geschlossen (drop): null.
 */
export function pushRunState(repo: string): void {
  if (runTimers.has(repo)) return;
  runTimers.set(
    repo,
    setTimeout(() => {
      runTimers.delete(repo);
      let text = "";
      if (peek(repo)) {
        const failed = failedItems(repo);
        text = tailOutput(repo) + (failed.length ? failuresReport(failed, 20) : "");
      }
      invoke("ide_run_state", { repo, state: text || null }).catch(() => {});
    }, 1000),
  );
}

/** Ausgabe leeren ("Leeren"-Knopf). */
export function clearOutput(repo: string): void {
  const b = buf(repo);
  b.chunks = [];
  b.bytes = 0;
  b.sink?.(RESET);
  pushRunState(repo);
}

function unlisten(b: Buf) {
  for (const p of b.off) p.then((f) => f(), () => {});
  b.off = [];
}

/**
 * Startet cfg (sonst das gewaehlte Ziel) und dockt die Ausgabe an. Fuehrt Code aus dem Projekt aus: NUR aus Klick
 * oder Taste rufen. Laeuft schon etwas, passiert nichts. Fehler beim Start landen in der Ausgabe.
 */
export async function runStart(repo: string, cfg?: RunConfig): Promise<void> {
  const r = run(repo);
  await detect(repo);
  const c = cfg ?? chosen(repo);
  const s = editor(repo);
  if (!c) {
    s.error = "Nichts zum Starten gefunden (package.json-Script, startbares .csproj/.fsproj, Cargo.toml).";
    return;
  }
  if (r.current?.state === "running") return;
  // Fehlt etwas (SDK, Pakete)? Erst fragen und genau sagen, was woher wohin kaeme; Abbrechen startet nicht.
  const items = await runMissing(repo, c.dir, c.target).catch(() => []);
  const install = items.length > 0;
  if (install && !(await confirm("", "Installieren", "Vor dem Start fehlt:", { items, tone: "default" }))) return;
  // Waehrend der Rueckfrage doppelt gestartet (neu lesen, TS haelt den Zustand sonst fuer unveraendert)
  if (run(repo).current?.state === "running") return;
  setLayout(repo, groupOf(s.layout, RUN) ? activate(s.layout, RUN) : splitAt(s.layout, RUN, mainGroup(s.layout).id, "bottom"));

  const b = buf(repo);
  // Listener eines beendeten Laufs abbauen; seine letzten Zeilen kamen bis hierher noch an.
  unlisten(b);
  const id = `run-${crypto.randomUUID()}`;
  Object.assign(b, { id, chunks: [], bytes: 0, tail: "", fixed: false });
  b.sink?.(RESET);
  const mine = () => b.id === id && r.current?.id === id;
  const dec = new TextDecoder();
  r.current = { cfg: c, id, state: "running", exit: null, started: Date.now(), url: "" };
  pushRunState(repo);
  const out = new Channel<ArrayBuffer>((buf) => {
    if (!mine()) return;
    const bytes = new Uint8Array(buf);
    push(b, bytes);
    if (r.current?.state === "running") pushRunState(repo);
    const chunk = dec.decode(bytes, { stream: true });
    // Cursor-Abfrage (ConPTY beim Start): mit angehaengtem xterm antwortet es selbst.
    if (!b.sink && chunk.includes("\x1b[6n")) ptyWrite(id, "\x1b[1;1R").catch(() => {});
    if (c.target.kind !== "npm" || b.fixed) return;
    b.tail = scan(b.tail, chunk);
    const local = serverUrl(b.tail, true);
    b.fixed = !!local;
    const cur = r.current!;
    // Ohne "Local"-Zeile bleibt die erste Adresse stehen.
    const url = local ?? (cur.url || serverUrl(b.tail) || "");
    if (url !== cur.url) r.current = { ...cur, url };
  });
  // Exit-Listener vor dem Start, damit ein sofortiges Ende nicht verloren geht.
  b.off = [
    listen<number | null>(`pty-exit:${id}`, (e) => {
      if (!mine()) return;
      r.current = { ...r.current!, state: "exited", exit: e.payload ?? null, url: "" };
      pushRunState(repo);
    }),
  ];
  try {
    await Promise.all(b.off);
    // Inzwischen gestoppt: gar nicht erst starten.
    if (!mine()) return;
    await startCmd(id, repo, c.dir, c.target, out, $state.snapshot(profileOf(s.profiles, s.profile)), install);
  } catch (e) {
    if (!mine()) return;
    push(b, new TextEncoder().encode(`\x1b[31m${e}\x1b[0m\r\n`));
    r.current = { ...r.current!, state: "exited" };
    pushRunState(repo);
  }
}

/** Prozess samt Kindern stoppen; die Ausgabe bleibt. Das Promise endet, wenn die Prozesse beendet sind. */
export function runStop(repo: string): Promise<void> {
  const r = store.get(repo);
  const b = bufs.get(repo);
  if (!r?.current || !b?.id) return Promise.resolve();
  const id = b.id;
  b.id = "";
  unlisten(b);
  if (r.current.state === "running") r.current = { ...r.current, state: "idle", url: "" };
  pushRunState(repo);
  return ptyClose(id).catch(() => {});
}

/** Stoppen, warten, dasselbe Ziel neu starten (ohne Lauf: das gewaehlte). */
export async function runRestart(repo: string): Promise<void> {
  const cfg = store.get(repo)?.current?.cfg;
  await runStop(repo);
  await runStart(repo, cfg);
}

/** Eingabe aus RunPane an den laufenden Prozess. */
export function runWrite(repo: string, data: string): void {
  const cur = store.get(repo)?.current;
  if (cur?.state === "running") ptyWrite(cur.id, data).catch(() => {});
}
