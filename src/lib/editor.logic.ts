// Reine Entscheidungen des Editor-Stores, ohne Runen und ohne Laufzeit-Importe, damit `node --test` sie direkt laedt.
import type { Hunk } from "./diff.ts";

/** Was das Polling mit einer offenen Datei tut. */
export type Verdict = "none" | "reload" | "close" | "changed" | "deleted";

/**
 * was = mtime beim letzten Lesen/Speichern, now = mtime auf der Platte (null = gibt es nicht).
 * Ohne lokale Aenderungen wird still nachgeladen bzw. der Tab geschlossen, mit ihnen nur der Konflikt gemeldet.
 */
export function verdict(dirty: boolean, was: number | null, now: number | null): Verdict {
  if (was === now) return "none";
  if (dirty) return now === null ? "deleted" : "changed";
  return now === null ? "close" : "reload";
}

/** path ist `at` selbst oder liegt in diesem Ordner. */
export const under = (path: string, at: string) => path === at || path.startsWith(at + "/");

/** Neuer Pfad, nachdem `from` (Datei oder Ordner) nach `to` umbenannt wurde; null = nicht betroffen. */
export const moved = (path: string, from: string, to: string): string | null =>
  under(path, from) ? to + path.slice(from.length) : null;

/** Kleinste Ersetzung, die `a` zu `b` macht: gemeinsamer Anfang und Schluss bleiben stehen (und mit ihnen Cursor und Scrollposition). */
export function span(a: string, b: string): { from: number; to: number; insert: string } {
  const max = Math.min(a.length, b.length);
  let from = 0;
  while (from < max && a[from] === b[from]) from++;
  let end = 0;
  while (end < max - from && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from, to: a.length - end, insert: b.slice(from, b.length - end) };
}

/**
 * Eingabe im URL-Feld der Vorschau -> URL fuer den iframe; "" = Datei zeigen, null = abgelehnt.
 * Nur http(s): "javascript:" im iframe liefe mit den Rechten der App. Ohne Schema wird http:// ergaenzt ("localhost:5173").
 */
export function devUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return "";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `http://${v}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

// --- Dev-Server der Vorschau ---

const ANSI = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()*+].|[@-Z\\-_])/g;

/** Terminal-Output ohne Escape-Sequenzen (Farben, Titel, Zeichensatz, Bildschirm loeschen), Zeilenenden als "\n". */
export const plain = (raw: string) => raw.replace(ANSI, "").replace(/\r\n?/g, "\n");

// Dahinter muss (nach Satzzeichen) Leerraum, Klammer oder Anfuehrungszeichen stehen: eine mitten im Port
// abgeschnittene Ausgabe zaehlt nicht, "localhost.evil.com" auch nicht.
const LOOPBACK = /(https?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(:\d+)?(\/[^\s"'<>)\]]*)?(?=[.,;:]*[\s"'<>)\]])/;

/**
 * Lokale Adresse im Output (ueber plain()) eines Dev-Servers; null = noch keine. Eine Zeile mit "Local" (Vite,
 * Vue CLI, Next, Nuxt, Astro, CRA) gewinnt gegen die erste Adresse: davor stehen gern Proxy- oder API-Zeilen.
 * localOnly: nur solche Zeilen. Nur localhost/Loopback: nichts aus dem Output darf den iframe auf einen fremden
 * Host lenken. 0.0.0.0 wird zu localhost.
 */
export function serverUrl(text: string, localOnly = false): string | null {
  // Zeilen samt "\n": die letzte, noch unfertige Zeile besteht die Pruefung auf Leerraum dahinter nicht.
  const local = text.split(/(?<=\n)/).find((l) => /\bLocal\b/.test(l) && LOOPBACK.test(l));
  const m = LOOPBACK.exec(local ?? (localOnly ? "" : text));
  if (!m) return null;
  const host = m[2] === "0.0.0.0" || m[2] === "[::]" ? "localhost" : m[2];
  return `${m[1]}://${host}${m[3] ?? ""}${m[4]?.replace(/[.,;:]+$/, "") || "/"}`;
}

const LOCKS = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
] as const;
export const LOCKFILES: string[] = LOCKS.map(([f]) => f);

/** Paketmanager: Feld "packageManager" der package.json, sonst nach vorhandenem Lockfile, sonst npm. */
export function packageManager(pkg: string, present: string[]): string {
  try {
    const m = /^(npm|pnpm|yarn|bun)@/.exec(JSON.parse(pkg)?.packageManager ?? "");
    if (m) return m[1];
  } catch {
    // Kaputtes JSON: nach Lockfile.
  }
  return LOCKS.find(([f]) => present.includes(f))?.[1] ?? "npm";
}

/** Ordner ueber einer Datei, naechster zuerst, zuletzt "" (Projektordner): "a/b/c.ts" -> ["a/b", "a", ""]. */
export function ancestors(path: string): string[] {
  const p = path.split("/").slice(0, -1);
  return [...p.map((_, i) => p.slice(0, p.length - i).join("/")), ""];
}

/** Zu gross fuer Highlighting: ueber 1 MB oder eine Zeile ab 10 000 Zeichen (minifiziert); beides macht den Parser zaeh. */
export const huge = (text: string) => text.length > 1_000_000 || /[^\n]{10000}/.test(text);

/** Modifier-Taste fuer Tastenkuerzel in Texten, wie in +page.svelte. */
export const MOD = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "⌘" : "Strg";

const win = (repo: string) => repo.includes("\\");
const slash = (p: string) => p.replace(/\\/g, "/");

/** Absoluter Pfad (von claude) -> relativ zum Repo mit "/"; relative bleiben, wie sie sind. */
export function rel(repo: string, path: string): string {
  const r = slash(repo).replace(/\/$/, "") + "/";
  const p = slash(path);
  const same = win(repo) ? p.toLowerCase().startsWith(r.toLowerCase()) : p.startsWith(r);
  return same ? p.slice(r.length) : p.replace(/^\.\//, "");
}

/** Repo-relativer Pfad -> absolut mit dem Trenner des Repos (fuer claude). */
export function abs(repo: string, path: string): string {
  const p = repo.replace(/[\\/]$/, "") + "/" + path;
  return win(repo) ? p.replace(/\//g, "\\") : p;
}

// --- Zurueck/Vor ---

/** Cursorstelle fuer Zurueck/Vor; line ab 1. */
export type Spot = { path: string; line: number; col: number };

/** at oben auf den Stapel, ausser er liegt schon dort (gleiche Zeile); hoechstens max Eintraege. */
export function pushNav(stack: Spot[], at: Spot, max = 50): Spot[] {
  const top = stack.at(-1);
  if (top && top.path === at.path && top.line === at.line) return stack;
  return [...stack, at].slice(-max);
}

// --- Git-Gutter ---

export type GitMark = { line: number; kind: "add" | "mod" | "del" };

/**
 * Marken aus Hunks eines Diffs ohne Kontext (HEAD -> Puffer), Zeilen ab 1. Geloeschte Zeilen markieren die Zeile
 * davor, ganz oben die erste.
 */
export function gutterMarks(hunks: Hunk[]): GitMark[] {
  return hunks.flatMap((h): GitMark[] => {
    if (!h.newLines) return [{ line: Math.max(1, h.newStart), kind: "del" }];
    const kind = h.oldLines ? "mod" : "add";
    return Array.from({ length: h.newLines }, (_, i) => ({ line: h.newStart + i, kind }));
  });
}
