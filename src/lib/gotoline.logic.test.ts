import { test } from "node:test";
import assert from "node:assert/strict";
import { gotoLabel, parseGoto } from "./gotoline.logic.ts";

test("parseGoto: Zeile, Zeile:Spalte, Komma, Leerzeichen", () => {
  assert.deepEqual(parseGoto(":42"), { line: 42 });
  assert.deepEqual(parseGoto(":42:7"), { line: 42, col: 6 });
  assert.deepEqual(parseGoto(":42,7"), { line: 42, col: 6 });
  assert.deepEqual(parseGoto(": 42 : 7 "), { line: 42, col: 6 });
});

test("parseGoto: 0 wird 1, ohne Zahl oder mit Text null", () => {
  assert.deepEqual(parseGoto(":0"), { line: 1 });
  assert.deepEqual(parseGoto(":3:0"), { line: 3, col: 0 });
  assert.equal(parseGoto(":"), null);
  assert.equal(parseGoto(":42:"), null);
  assert.equal(parseGoto(":abc"), null);
  assert.equal(parseGoto("42"), null);
  assert.equal(parseGoto(":-3"), null);
});

test("gotoLabel zeigt Spalte 1-basiert", () => {
  assert.equal(gotoLabel({ line: 42 }), "Zu Zeile 42 springen");
  assert.equal(gotoLabel({ line: 42, col: 6 }), "Zu Zeile 42, Spalte 7 springen");
});
