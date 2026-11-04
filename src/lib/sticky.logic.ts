// Pure helpers for sticky scroll (src/lib/components/editor/sticky.ts).

/** Indentation column (tabs to the next tab stop), -1 for blank lines. */
function col(s: string, tabSize: number): number {
  let c = 0;
  for (const ch of s) {
    if (ch === " ") c++;
    else if (ch === "\t") c += tabSize - (c % tabSize);
    else return c;
  }
  return -1;
}

/**
 * Lines above n that are less indented than every non-blank line between them and n: the headers of the indentation
 * blocks around n, innermost first. `up` caches each line's nearest less indented line above (0 = none) for one
 * document, so a line deep in a long block costs a few jumps over sibling blocks instead of a scan up to its header.
 */
export function indentParents(line: (n: number) => string, n: number, tabSize = 4, up = new Map<number, number>()): number[] {
  const indent = (i: number) => col(line(i), tabSize);
  // Iterative, with an explicit stack: a line needs the parents of the sibling blocks above it first.
  const parent = (i: number): number => {
    const todo = [i];
    while (todo.length) {
      const x = todo[todo.length - 1];
      if (up.has(x)) {
        todo.pop();
        continue;
      }
      const d = indent(x);
      let j = x - 1;
      let found = -1;
      while (found < 0) {
        if (j < 1 || d === 0) found = 0;
        else {
          const dj = indent(j);
          if (dj < 0) j--;
          else if (dj < d) found = j;
          // Everything between j's parent and j is at least as indented as j
          else if (up.has(j)) j = up.get(j)!;
          else break;
        }
      }
      if (found < 0) todo.push(j);
      else {
        up.set(x, found);
        todo.pop();
      }
    }
    return up.get(i)!;
  };
  let p = n;
  while (p >= 1 && indent(p) < 0) p--;
  if (p < 1) return [];
  const out = p < n ? [p] : [];
  for (p = parent(p); p > 0; p = parent(p)) out.push(p);
  return out;
}

/** Header lines above n whose scope (last line from `end`) still reaches n. */
export function enclosing(cands: Iterable<number>, n: number, end: (h: number) => number | null): number[] {
  return [...new Set(cands)].filter((h) => h < n && (end(h) ?? 0) >= n);
}

/**
 * Which headers to pin, as VS Code does: row d (from y = top + d * lh) shows the next scope whose header line is already
 * behind it and whose last line still reaches into it. A scope ending inside its row pushes that row up by `push` (<= 0)
 * and closes the stack. `bottoms` gives the y of the bottom edge of the header line and of the scope's last line.
 */
export function stack(
  headers: number[],
  top: number,
  lh: number,
  max: number,
  bottoms: (h: number) => [header: number, end: number],
): { lines: number[]; push: number } {
  const lines: number[] = [];
  for (const h of [...headers].sort((a, b) => a - b)) {
    if (lines.length === max) break;
    const rowTop = top + lines.length * lh;
    const [hb, eb] = bottoms(h);
    // Sorted by line: every later header is at least as far down. The pixel of slack keeps a header that was scrolled
    // to exactly below the stack (click on a pinned line) from counting as hidden through rounding.
    if (hb > rowTop + lh - 1) break;
    // Already scrolled past (but for a pixel), or folded into its header line
    if (eb < rowTop + 1 || eb <= hb) continue;
    lines.push(h);
    if (eb < rowTop + lh) return { lines, push: eb - rowTop - lh };
  }
  return { lines, push: 0 };
}

/** A Markdown section: heading position and level, last position, index of the enclosing section (-1 = none). */
export type Section = { from: number; level: number; to: number; parent: number };

/**
 * Markdown sections from the top-level blocks in document order (level 0 for blocks that are no heading). A section runs
 * to the end of the block before the next heading of the same or a higher level, as CodeMirror's Markdown folding.
 * Sections still open after the last block end at `rest` (the document end when the parse has not reached it), else
 * with that block.
 */
export function sections(blocks: Iterable<{ level: number; from: number; to: number }>, rest?: number): Section[] {
  const out: Section[] = [];
  const open: number[] = [];
  let end = 0;
  for (const b of blocks) {
    if (b.level) {
      while (open.length && out[open.at(-1)!].level >= b.level) out[open.pop()!].to = end;
      open.push(out.push({ from: b.from, level: b.level, to: 0, parent: open.at(-1) ?? -1 }) - 1);
    }
    end = b.to;
  }
  for (const i of open) out[i].to = rest ?? end;
  return out;
}
