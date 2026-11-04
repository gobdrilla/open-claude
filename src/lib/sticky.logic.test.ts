import { test } from "node:test";
import assert from "node:assert/strict";
import { enclosing, indentParents, sections, stack } from "./sticky.logic.ts";

const doc = (s: string) => {
  const lines = s.split("\n");
  return (n: number) => lines[n - 1];
};

test("indentParents walks up to less indented lines, innermost first", () => {
  const line = doc(["a:", "  b:", "    c: 1", "", "    d:", "      e: 2"].join("\n"));
  assert.deepEqual(indentParents(line, 6), [5, 2, 1]);
  // c and d are siblings: d is not a parent of its sibling's child
  assert.deepEqual(indentParents(line, 3), [2, 1]);
  assert.deepEqual(indentParents(line, 1), []);
});

test("indentParents on a blank line takes the next non-blank line above as candidate", () => {
  const line = doc(["class A {", "  f() {", "  }", "", "  g() {}", "}"].join("\n"));
  assert.deepEqual(indentParents(line, 4), [3, 1]);
});

test("indentParents counts tabs to the tab stop", () => {
  const line = doc(["x", "\ty", "    z"].join("\n"));
  // tab = 4 columns: z (4) is not deeper than y (4)
  assert.deepEqual(indentParents(line, 3, 4), [1]);
  assert.deepEqual(indentParents(line, 3, 2), [2, 1]);
});

test("indentParents matches a plain upward scan on a long nested document, with a shared cache", () => {
  // 3 levels of sibling blocks with blank lines and dedents, like YAML under one root key
  const lines = ["root:"];
  for (let a = 0; a < 40; a++) {
    lines.push(`  a${a}:`);
    for (let b = 0; b < 6; b++) lines.push(`    b${b}:`, `      c: 1`, "", `      d:`, `        - e`);
  }
  lines.push("tail: 1", "  t: 2", "");
  const line = doc(lines.join("\n"));
  const scan = (n: number) => {
    let min = line(n).trim() ? line(n).search(/\S/) : Infinity;
    const out: number[] = [];
    for (let i = n - 1; i >= 1 && min > 0; i--) {
      if (!line(i).trim()) continue;
      const d = line(i).search(/\S/);
      if (d < min) {
        out.push(i);
        min = d;
      }
    }
    return out;
  };
  const up = new Map<number, number>();
  // Bottom-up and top-down orders exercise both directions of the cache
  for (let n = lines.length; n >= 1; n -= 7) assert.deepEqual(indentParents(line, n, 4, up), scan(n), `line ${n}`);
  for (let n = 1; n <= lines.length; n++) assert.deepEqual(indentParents(line, n, 4, up), scan(n), `line ${n}`);
  for (let n = 1; n <= lines.length; n++) assert.deepEqual(indentParents(line, n), scan(n), `line ${n} uncached`);
});

test("enclosing keeps headers above n whose scope reaches n, deduplicated", () => {
  const ends: Record<number, number> = { 1: 100, 3: 50, 5: 9, 7: 20 };
  const end = (h: number) => ends[h] ?? null;
  assert.deepEqual(enclosing([7, 5, 3, 3, 1, 2], 10, end), [7, 3, 1]);
  // The scope's last line still counts, a header is never its own scope
  assert.deepEqual(enclosing([7], 20, end), [7]);
  assert.deepEqual(enclosing([7], 21, end), []);
  assert.deepEqual(enclosing([10], 10, () => 99), []);
});

// Lines of height 10 starting at y = 0: line n spans [(n - 1) * 10, n * 10].
const ends: Record<number, number> = { 1: 40, 3: 30, 5: 8, 12: 14 };
const bottoms = (h: number): [number, number] => [h * 10, ends[h] * 10];

test("stack pins the headers behind each row, outermost first", () => {
  // Top edge in line 4: row 0 covers 30..40 (scope 1 reaches line 40), row 1 covers 40..50 (scope 3 until line 30)
  assert.deepEqual(stack([3, 1], 35, 10, 5, bottoms), { lines: [1, 3], push: 0 });
  // Header of scope 3 still visible below row 1
  assert.deepEqual(stack([1, 3], 5, 10, 5, bottoms), { lines: [1], push: 0 });
  // Not before the header has scrolled at least partly behind the row
  assert.deepEqual(stack([1], 0, 10, 5, bottoms), { lines: [], push: 0 });
  assert.deepEqual(stack([1], 0.5, 10, 5, bottoms), { lines: [], push: 0 });
  assert.deepEqual(stack([1], 1.5, 10, 5, bottoms), { lines: [1], push: 0 });
  assert.deepEqual(stack([1, 3], 35, 10, 1, bottoms), { lines: [1], push: 0 });
});

test("stack pushes the row of a scope that ends inside it and skips finished ones", () => {
  // Scope 3 ends at y = 300; row 1 at 285..295 fits, at 292..302 it is pushed up by 2
  assert.deepEqual(stack([1, 3], 275, 10, 5, bottoms), { lines: [1, 3], push: 0 });
  assert.deepEqual(stack([1, 3], 282, 10, 5, bottoms), { lines: [1, 3], push: -2 });
  // Siblings 3 (until line 10) and 12 (until 14): a finished scope gives its row to the next one once its header is behind
  const sib = (h: number): [number, number] => [h * 10, ({ 1: 40, 3: 10, 12: 14 } as Record<number, number>)[h] * 10];
  assert.deepEqual(stack([1, 3, 12], 95, 10, 5, sib), { lines: [1], push: 0 });
  assert.deepEqual(stack([1, 3, 12], 110, 10, 5, sib), { lines: [1, 12], push: 0 });
  // Folded scope: its last line ends with the header line
  assert.deepEqual(stack([5], 45, 10, 5, (h) => [h * 10, h * 10]), { lines: [], push: 0 });
});

test("sections nest by heading level and end before the next heading of the same or a higher level", () => {
  // # A (0-3), text, ## B (10-14), text, ### C, ## D, text, # E, text
  const b = (level: number, from: number, to: number) => ({ level, from, to });
  const blocks = [b(1, 0, 3), b(0, 5, 8), b(2, 10, 14), b(0, 16, 20), b(3, 22, 25), b(2, 27, 30), b(0, 32, 35), b(1, 37, 40), b(0, 42, 45)];
  assert.deepEqual(sections(blocks), [
    { from: 0, level: 1, to: 35, parent: -1 },
    { from: 10, level: 2, to: 25, parent: 0 },
    { from: 22, level: 3, to: 25, parent: 1 },
    { from: 27, level: 2, to: 35, parent: 0 },
    { from: 37, level: 1, to: 45, parent: -1 },
  ]);
  // Parse not done: what is still open runs to the document end.
  assert.deepEqual(sections(blocks.slice(0, 4), 100).map((s) => s.to), [100, 100]);
  assert.deepEqual(sections([]), []);
});
