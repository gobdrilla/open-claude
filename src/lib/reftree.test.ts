import { test } from "node:test";
import assert from "node:assert/strict";
import { refRows } from "./reftree.ts";

const id = (s: string) => s;
const view = (rows: ReturnType<typeof refRows<string>>) =>
  rows.map((r) => `${"  ".repeat(r.depth)}${r.label}${r.dir ? `/(${r.count})` : ""}`);

test("flat names stay depth 0 in input order", () => {
  const rows = refRows(["main", "dev", "a"], id, () => true);
  assert.deepEqual(view(rows), ["main", "dev", "a"]);
  assert.ok(rows.every((r) => !r.dir && r.path === r.label));
});

test("closed folder shows its count, no children", () => {
  const rows = refRows(["main", "issue/1", "issue/2"], id, () => false);
  assert.deepEqual(view(rows), ["issue/(2)", "main"]);
  assert.equal(rows[0].dir && rows[0].open, false);
});

test("open folder lists children with full path", () => {
  const rows = refRows(["main", "issue/1", "issue/2"], id, (p) => p === "issue");
  assert.deepEqual(view(rows), ["issue/(2)", "  1", "  2", "main"]);
  assert.deepEqual(
    rows.filter((r) => !r.dir).map((r) => [r.path, !r.dir && r.ref]),
    [["issue/1", "issue/1"], ["issue/2", "issue/2"], ["main", "main"]],
  );
});

test("nested folders count all refs below and respect isOpen per level", () => {
  const asked: string[] = [];
  const rows = refRows(["a/b/c", "a/d"], id, (p) => (asked.push(p), p === "a"));
  assert.deepEqual(view(rows), ["a/(2)", "  b/(1)", "  d"]);
  assert.deepEqual(asked, ["a", "a/b"]);
});

test("folders before leaves, otherwise incoming order (tags newest first)", () => {
  const rows = refRows(["v2", "rel/x", "v1", "zz/q", "rel/y"], id, () => true);
  assert.deepEqual(view(rows), ["rel/(2)", "  x", "  y", "zz/(1)", "  q","v2", "v1"]);
});

test("leaf and folder of the same name do not collide", () => {
  const rows = refRows(["x", "x/y"], id, () => true);
  assert.deepEqual(view(rows), ["x/(1)", "  y", "x"]);
});

test("10k refs in 100 closed folders give 100 rows", () => {
  const names = Array.from({ length: 10_000 }, (_, i) => `f${i % 100}/n${i}`);
  const rows = refRows(names, id, () => false);
  assert.equal(rows.length, 100);
  assert.ok(rows.every((r) => r.dir && r.count === 100));
});
