// Revert a hunk of the "HEAD -> buffer" diff inside the editor buffer (git gutter dialog in CodePane).
import type { Hunk } from "./diff.ts";

export type Change = { from: number; to: number; insert: string };

/**
 * Change that puts the HEAD side of `hunk` back into `doc`. `selected` = indices into hunk.lines (only those
 * lines are reverted: selected "+" lines go, selected "-" lines come back); empty = the whole hunk.
 * null when the hunk's new side no longer matches `doc` (stale diff).
 */
export function revertHunk(doc: string, hunk: Hunk, selected: Set<number>): Change | null {
  const all = selected.size === 0;
  type Line = { text: string; nl: boolean };
  const now: Line[] = [];
  const out: Line[] = [];
  hunk.lines.forEach((l, i) => {
    if (l.kind === "meta") return;
    // "\ No newline at end of file" after a line: that line is the last one of its side, without "\n".
    const line = { text: l.text.replace(/\r$/, ""), nl: hunk.lines[i + 1]?.kind !== "meta" };
    if (l.kind !== "del") now.push(line);
    const back = all || selected.has(i);
    if (l.kind === "ctx" || (l.kind === "add" ? !back : back)) out.push({ ...line });
  });
  // A restored last line may now have lines after it.
  out.forEach((l, i) => i < out.length - 1 && (l.nl = true));

  // Without new-side lines (newLines 0) newStart is the line before the hunk.
  const first = hunk.newLines ? hunk.newStart : hunk.newStart + 1;
  let from = 0;
  for (let n = 1; n < first; n++) {
    const i = doc.indexOf("\n", from);
    if (i < 0) return null;
    from = i + 1;
  }
  const eol = doc.includes("\r\n") ? "\r\n" : "\n";
  let to = from;
  for (const l of now) {
    if (!doc.startsWith(l.text, to)) return null;
    to += l.text.length;
    const brk = doc.startsWith("\r\n", to) ? 2 : doc[to] === "\n" ? 1 : 0;
    if (l.nl !== brk > 0 || (!l.nl && to !== doc.length)) return null;
    to += brk;
  }
  return { from, to, insert: out.map((l) => l.text + (l.nl ? eol : "")).join("") };
}
