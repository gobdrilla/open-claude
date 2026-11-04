import { test } from "node:test";
import assert from "node:assert/strict";
import { lensLabel, lensOf, lineLenses, toLocs, uniqueLocs, type Loc, crumbsAt, symbolTree, type SymNode } from "./nav.logic.ts";

const r = (line: number, character = 0) => ({ start: { line, character }, end: { line, character: character + 1 } });

test("toLocs takes Location, Location[] and LocationLink[]", () => {
  assert.deepEqual(toLocs(null), []);
  assert.deepEqual(toLocs({ uri: "a", range: r(1) }), [{ uri: "a", range: r(1) }]);
  assert.deepEqual(toLocs([{ targetUri: "b", targetRange: r(1), targetSelectionRange: r(2) }]), [{ uri: "b", range: r(2) }]);
  assert.deepEqual(toLocs([{ targetUri: "b", targetRange: r(3) }]), [{ uri: "b", range: r(3) }]);
});

test("uniqueLocs drops duplicates and sorts by file and position", () => {
  const l = (uri: string, line: number, ch = 0): Loc => ({ uri, range: r(line, ch) });
  assert.deepEqual(uniqueLocs([l("b", 1), l("a", 5), l("a", 2), l("a", 5), l("a", 2, 4)]), [l("a", 2), l("a", 2, 4), l("a", 5), l("b", 1)]);
});

test("lensOf reads the titles of csharp-ls, typescript and rust-analyzer", () => {
  assert.deepEqual(lensOf("5 Reference(s)"), { kind: "refs", count: 5 });
  assert.deepEqual(lensOf("0 Reference(s)"), { kind: "refs", count: 0 });
  assert.deepEqual(lensOf("1 reference"), { kind: "refs", count: 1 });
  assert.deepEqual(lensOf("12 implementations"), { kind: "impls", count: 12 });
  assert.deepEqual(lensOf("No references"), { kind: "refs", count: 0 });
  assert.equal(lensOf("▶︎ Run"), null);
  assert.equal(lensOf("Run Test"), null);
  assert.equal(lensOf(""), null);
});

test("lensLabel is German with singular and plural", () => {
  assert.equal(lensLabel({ kind: "refs", count: 0 }), "keine Verwendungen");
  assert.equal(lensLabel({ kind: "refs", count: 1 }), "1 Verwendung");
  assert.equal(lensLabel({ kind: "refs", count: 7 }), "7 Verwendungen");
  assert.equal(lensLabel({ kind: "impls", count: 1 }), "1 Implementierung");
  assert.equal(lensLabel({ kind: "impls", count: 2 }), "2 Implementierungen");
});

test("lineLenses groups per line, usages first, no empty implementation counts, no doubles", () => {
  const m = lineLenses([
    { line: 3, character: 4, kind: "impls", count: 2 },
    { line: 3, character: 4, kind: "refs", count: 5 },
    { line: 3, character: 9, kind: "refs", count: 1 },
    { line: 8, character: 0, kind: "impls", count: 0 },
    { line: 9, character: 0, kind: "refs", count: 0 },
  ]);
  assert.deepEqual(
    m.get(3)!.map((l) => [l.kind, l.count]),
    [
      ["refs", 5],
      ["impls", 2],
    ],
  );
  assert.equal(m.has(8), false);
  assert.deepEqual(m.get(9)!.map((l) => l.count), [0]);
});

const rg = (a: number, b: number, c: number, d: number) => ({ start: { line: a, character: b }, end: { line: c, character: d } });
const sym = (name: string, kind: number, range: ReturnType<typeof rg>, children?: SymNode[]): SymNode => ({ name, kind, range, selectionRange: range, children });

test("crumbsAt walks nested symbols, skips the file symbol and keeps siblings", () => {
  const area = sym("Area", 6, rg(3, 2, 3, 30));
  const name = sym("Name", 7, rg(4, 2, 4, 30));
  const shape = sym("Shape", 5, rg(2, 0, 5, 1), [area, name]);
  const tree = [sym("Shapes.cs", 1, rg(0, 0, 9, 0), [sym("Lab", 3, rg(0, 0, 9, 0), [shape, sym("Circle", 5, rg(6, 0, 8, 1))])])];
  const at = crumbsAt(tree, { line: 3, character: 10 });
  assert.deepEqual(at.map((c) => c.sym.name), ["Lab", "Shape", "Area"]);
  assert.deepEqual(at[1].siblings.map((s) => s.name), ["Shape", "Circle"]);
  assert.deepEqual(at[2].siblings.map((s) => s.name), ["Area", "Name"]);
  assert.deepEqual(crumbsAt(tree, { line: 5, character: 1 }).map((c) => c.sym.name), ["Lab", "Shape"], "end is inside");
  assert.deepEqual(crumbsAt([], { line: 0, character: 0 }), []);
});

test("crumbsAt on a flat answer orders containing symbols by size", () => {
  const tree = symbolTree([
    { name: "run", kind: 6, location: { range: rg(2, 2, 4, 3) } },
    { name: "App", kind: 5, location: { range: rg(0, 0, 9, 1) } },
    { name: "other", kind: 12, location: { range: rg(11, 0, 12, 1) } },
  ]);
  assert.deepEqual(crumbsAt(tree, { line: 3, character: 0 }).map((c) => c.sym.name), ["App", "run"]);
  assert.deepEqual(crumbsAt(tree, { line: 10, character: 0 }), []);
});
