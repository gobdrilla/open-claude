import { test } from "node:test";
import assert from "node:assert/strict";
import { lensLabel, lensOf, lineLenses, toLocs, uniqueLocs, type Loc } from "./nav.logic.ts";

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
