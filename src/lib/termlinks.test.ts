import { test } from "node:test";
import assert from "node:assert/strict";
import { keep, pathHits } from "./termlinks.ts";

const paths = (t: string) => pathHits(t).map((h) => [h.path, h.line, h.col]);

test("pfade mit zeile und spalte", () => {
  assert.deepEqual(paths("  ⎿  src/lib/a.ts:42 und b.rs:3:7"), [["src/lib/a.ts", 42, undefined], ["b.rs", 3, 7]]);
  assert.deepEqual(paths("⏺ Update(src/routes/+page.svelte)"), [["src/routes/+page.svelte", undefined, undefined]]);
  assert.deepEqual(paths("siehe `package.json`."), [["package.json", undefined, undefined]]);
  assert.deepEqual(paths("/Users/x/dev/a.ts C:\\dev\\b.ts:1").slice(1), [["/Users/x/dev/a.ts", undefined, undefined], ["C:\\dev\\b.ts", 1, undefined]]);
  assert.deepEqual(paths("./x.rs ../y.md ~/z.toml"), [["./x.rs", undefined, undefined], ["../y.md", undefined, undefined], ["~/z.toml", undefined, undefined]]);
});

test("ganze zeile mit leerzeichen", () => {
  const p = "/Users/m/roms/ps2/Initial D - Special Stage (Japan) (v2.00).iso";
  assert.deepEqual(pathHits(`  ${p}  `)[0], { start: 2, end: 2 + p.length, path: p, line: undefined, col: undefined });
  assert.deepEqual(paths("~/a b/c.md:12")[0], ["~/a b/c.md", 12, undefined]);
  assert.deepEqual(paths("C:\\Users\\a b\\x.ts")[0], ["C:\\Users\\a b\\x.ts", undefined, undefined]);
  // Existiert die ganze Zeile, verdraengt sie die Teilstuecke; sonst bleiben die Einzelpfade
  const two = pathHits("/x/a.ts /y/b.ts");
  assert.deepEqual(keep(two).map((h) => h.path), ["/x/a.ts /y/b.ts"]);
  assert.deepEqual(keep(two.slice(1)).map((h) => h.path), ["/x/a.ts", "/y/b.ts"]);
  // Windows-Pfad mit Leerzeichen mitten im Satz: Kandidat ab dem Laufwerk, keep waehlt den laengsten existierenden
  const win = pathHits("Fehler in C:\\Users\\Max Muster\\x.ts:12 gefunden");
  assert.deepEqual(win.map((h) => [h.path, h.line]), [["Muster\\x.ts", 12], ["C:\\Users\\Max Muster\\x.ts", 12]]);
  assert.deepEqual(keep(win).map((h) => [h.start, h.end]), [[10, 37]]);
  assert.deepEqual(paths("C:\\a\\x.ts (siehe b.ts)").map((h) => h[0]), ["C:\\a\\x.ts", "b.ts"]);
  // Satz mit Pfad darin: nur der Pfad, nicht die ganze Zeile
  assert.deepEqual(paths("/tmp/a.ts ist kaputt."), [["/tmp/a.ts", undefined, undefined]]);
});

test("keine pfade", () => {
  assert.deepEqual(paths("https://example.dev/a.md"), []);
  assert.deepEqual(paths("src/lib und 1.5 und ende."), []);
});

test("spalten", () => {
  const [h] = pathHits("ab a.ts:3 c");
  assert.deepEqual([h.start, h.end], [3, 9]);
});
