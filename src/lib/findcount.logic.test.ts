import { test } from "node:test";
import assert from "node:assert/strict";
import { countLabel, countMatches } from "./findcount.logic.ts";

const it = (...from: number[]) => from.map((f) => ({ from: f, to: f + 2 }))[Symbol.iterator]();

test("countMatches: Position der Auswahl unter allen Treffern", () => {
  assert.deepEqual(countMatches(it(1, 5, 9), { from: 5, to: 7 }), { index: 2, total: 3, more: false });
  assert.deepEqual(countMatches(it(1, 5, 9), { from: 5, to: 6 }), { index: 0, total: 3, more: false });
  assert.deepEqual(countMatches(it(), { from: 0, to: 0 }), { index: 0, total: 0, more: false });
});

test("countMatches: bricht bei cap ab", () => {
  assert.deepEqual(countMatches(it(1, 5, 9, 13), { from: 5, to: 7 }, 3), { index: 2, total: 3, more: true });
  assert.deepEqual(countMatches(it(1, 5, 9), { from: 1, to: 3 }, 3), { index: 1, total: 3, more: false });
  assert.deepEqual(countMatches(it(1, 5, 9, 13), { from: 13, to: 15 }, 3), { index: 0, total: 3, more: true });
});

test("countLabel", () => {
  assert.equal(countLabel({ index: 3, total: 12, more: false }), "3 von 12");
  assert.equal(countLabel({ index: 0, total: 12, more: false }), "12 Treffer");
  assert.equal(countLabel({ index: 0, total: 0, more: false }), "Keine Treffer");
  assert.equal(countLabel({ index: 7, total: 1000, more: true }), "7 von 1000+");
  assert.equal(countLabel({ index: 0, total: 1000, more: true }), "1000+ Treffer");
  assert.equal(countLabel({ index: -1, total: 1000, more: true }), "? von 1000+");
});
