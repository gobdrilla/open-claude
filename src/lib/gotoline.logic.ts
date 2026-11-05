import { t as tr } from "./i18n.ts";

/** Go to line in Strg+P: ":42" or ":42:7" (also ":42,7"). line is 1-based, col 0-based for open(); null = no number yet. */
export function parseGoto(q: string): { line: number; col?: number } | null {
  const m = /^:\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(q);
  if (!m) return null;
  const line = Math.max(1, Number(m[1]));
  return m[2] === undefined ? { line } : { line, col: Math.max(1, Number(m[2])) - 1 };
}

/** List entry text for a parsed target. */
export const gotoLabel = (t: { line: number; col?: number }) =>
  t.col === undefined ? tr("Zu Zeile {line} springen", { line: t.line }) : tr("Zu Zeile {line}, Spalte {col} springen", { line: t.line, col: t.col + 1 });
