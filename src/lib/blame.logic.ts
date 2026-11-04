// Texts for the inline git blame in the editor (components/editor/blame.ts).
import type { BlameCommit } from "./files.ts";

export const uncommitted = (c: BlameCommit) => /^0+$/.test(c.sha);

const rtf = new Intl.RelativeTimeFormat("de", { numeric: "always" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "vor 3 Tagen"; time and now in seconds. */
export function ago(time: number, now = Date.now() / 1000): string {
  const d = now - time;
  for (const [unit, s] of STEPS) if (d >= s) return rtf.format(-Math.floor(d / s), unit);
  return "gerade eben";
}

/** "Autor, vor 3 Tagen • Betreff" after the cursor line. */
export const blameLabel = (c: BlameCommit, now?: number) =>
  uncommitted(c) ? "Noch nicht committet" : `${c.author}, ${ago(c.time, now)} • ${c.summary}`;

/** Tooltip: full sha, author, date, message. */
export const blameTitle = (c: BlameCommit) =>
  uncommitted(c)
    ? "Noch nicht committet"
    : `${c.sha}\n${c.author} · ${new Date(c.time * 1000).toLocaleString("de-DE")}\n\n${c.summary}\n\nKlick: im Git-Verlauf zeigen`;
