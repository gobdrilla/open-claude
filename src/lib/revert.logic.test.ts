import { test } from "node:test";
import assert from "node:assert/strict";
import { revertHunk } from "./revert.logic.ts";
import { parseDiff } from "./diff.ts";

const hunk = (...body: string[]) => parseDiff(["diff --git a/f b/f", "--- a/f", "+++ b/f", ...body, ""].join("\n"))[0].hunks[0];
const revert = (doc: string, h: ReturnType<typeof hunk>, sel: number[] = []) => {
  const c = revertHunk(doc, h, new Set(sel));
  return c && doc.slice(0, c.from) + c.insert + doc.slice(c.to);
};

test("ganzer Hunk in der Mitte", () => {
  const h = hunk("@@ -2,5 +2,5 @@", " b", " c", "-d", "+D", " e", " f");
  assert.equal(revert("a\nb\nc\nD\ne\nf\ng\n", h), "a\nb\nc\nd\ne\nf\ng\n");
});

test("gewaehlte Zeilen: nur diese zuruecksetzen", () => {
  const h = hunk("@@ -1,3 +1,4 @@", " a", "-b", "+X", "+Y", " c");
  const doc = "a\nX\nY\nc\n";
  assert.equal(revert(doc, h, [2]), "a\nY\nc\n"); // only "+X" goes
  assert.equal(revert(doc, h, [1]), "a\nb\nX\nY\nc\n"); // only "-b" comes back
  assert.equal(revert(doc, h, [1, 2, 3]), "a\nb\nc\n");
});

test("Hunk am Dateianfang", () => {
  const h = hunk("@@ -1,4 +1,4 @@", "-a", "+Z", " b", " c", " d");
  assert.equal(revert("Z\nb\nc\nd\n", h), "a\nb\nc\nd\n");
});

test("Hunk am Dateiende, mit und ohne letzten Zeilenumbruch", () => {
  // HEAD without final newline, buffer with
  const a = hunk("@@ -1,3 +1,3 @@", " a", " b", "-c", "\\ No newline at end of file", "+c");
  assert.equal(revert("a\nb\nc\n", a), "a\nb\nc");
  // buffer without final newline
  const b = hunk("@@ -1,2 +1,3 @@", " a", " b", "+X", "\\ No newline at end of file");
  assert.equal(revert("a\nb\nX", b), "a\nb\n");
  // restoring "-c" (no newline in HEAD) while "+d" stays: c needs its newline back
  const c = hunk("@@ -1,2 +1,2 @@", " a", "-c", "\\ No newline at end of file", "+d");
  assert.equal(revert("a\nd\n", c, [1]), "a\nc\nd\n");
});

test("nur Loeschungen", () => {
  assert.equal(revert("a\nd\n", hunk("@@ -1,4 +1,2 @@", " a", "-b", "-c", " d")), "a\nb\nc\nd\n");
  // without context (newLines 0: newStart is the line before)
  assert.equal(revert("a\nd\n", hunk("@@ -2,2 +1,0 @@", "-b", "-c")), "a\nb\nc\nd\n");
  // at the very start and the whole file
  assert.equal(revert("c\n", hunk("@@ -1,2 +0,0 @@", "-a", "-b")), "a\nb\nc\n");
  assert.equal(revert("", hunk("@@ -1 +0,0 @@", "-a")), "a\n");
});

test("nur Hinzufuegungen", () => {
  assert.equal(revert("a\nX\nY\nb\n", hunk("@@ -1,2 +1,4 @@", " a", "+X", "+Y", " b")), "a\nb\n");
  assert.equal(revert("a\n", hunk("@@ -0,0 +1 @@", "+a")), "");
  assert.equal(revert("X\na\n", hunk("@@ -0,0 +1 @@", "+X")), "a\n");
});

test("Zeilenenden: CR im Diff und CRLF im Puffer", () => {
  const cr = hunk("@@ -1,3 +1,3 @@", " a\r", "-b\r", "+B\r", " c\r");
  assert.equal(revert("a\nB\nc\n", cr), "a\nb\nc\n");
  const lf = hunk("@@ -1,3 +1,3 @@", " a", "-b", "+B", " c");
  assert.equal(revert("a\r\nB\r\nc\r\n", lf), "a\r\nb\r\nc\r\n");
});

test("veralteter Diff: null statt falsch ersetzen", () => {
  const h = hunk("@@ -1,3 +1,3 @@", " a", "-b", "+B", " c");
  assert.equal(revertHunk("a\nB2\nc\n", h, new Set()), null);
  assert.equal(revertHunk("a\nB\n", h, new Set()), null); // file got shorter
  assert.equal(revertHunk("x\na\nB\nc\n", h, new Set()), null); // lines moved down
  // last line got longer
  assert.equal(revertHunk("a\nb\nXc", hunk("@@ -1,2 +1,3 @@", " a", " b", "+X", "\\ No newline at end of file"), new Set()), null);
});
