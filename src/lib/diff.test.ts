import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, linesPatch, fileDiff, stat, reviewPrompt } from "./diff.ts";

const sample = `diff --git a/src/x.ts b/src/x.ts
index 1111111..2222222 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,3 @@ function f() {
 a
-b
+B
 c
diff --git "a/\\303\\244 neu.txt" "b/\\303\\244 neu.txt"
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ "b/\\303\\244 neu.txt"
@@ -0,0 +1 @@
+x
\\ No newline at end of file
diff --git a/alt.md b/neu.md
similarity index 100%
rename from alt.md
rename to neu.md
diff --git a/bild.png b/bild.png
index 4444444..5555555 100644
Binary files a/bild.png and b/bild.png differ
`;

test("parst Dateien, Status, Pfade und Zeilennummern", () => {
  const [mod, add, ren, bin] = parseDiff(sample);
  assert.equal(mod.newPath, "src/x.ts");
  assert.equal(mod.status, "modified");
  assert.deepEqual(mod.hunks[0].lines, [
    { kind: "ctx", text: "a", old: 1, new: 1 },
    { kind: "del", text: "b", old: 2 },
    { kind: "add", text: "B", new: 2 },
    { kind: "ctx", text: "c", old: 3, new: 3 },
  ]);
  assert.equal(add.status, "added");
  assert.equal(add.newPath, "ä neu.txt");
  assert.equal(add.oldPath, "ä neu.txt");
  assert.equal(add.hunks[0].newLines, 1);
  assert.equal(add.hunks[0].lines[1].kind, "meta");
  assert.deepEqual([ren.status, ren.oldPath, ren.newPath, ren.hunks.length], ["renamed", "alt.md", "neu.md", 0]);
  assert.deepEqual([bin.binary, bin.newPath], [true, "bild.png"]);
});

test("Zeilenauswahl: + weglassen, - zu Kontext, Header neu gerechnet", () => {
  const [f] = parseDiff(sample);
  assert.equal(
    linesPatch(f, f.hunks[0], new Set([2])),
    "diff --git a/src/x.ts b/src/x.ts\nindex 1111111..2222222 100644\n--- a/src/x.ts\n+++ b/src/x.ts\n" +
      "@@ -1,3 +1,4 @@\n a\n b\n+B\n c\n",
  );
  // rueckwaerts (nur -b unstagen): nicht gewaehltes + bleibt als Kontext
  assert.ok(linesPatch(f, f.hunks[0], new Set([1]), true).endsWith("@@ -1,4 +1,3 @@\n a\n-b\n B\n c\n"));
  assert.equal(linesPatch(f, f.hunks[0], new Set([0, 3])), "");
});

test("fileDiff: Roundtrip je Datei, stat zaehlt", () => {
  const mixed = `diff --git a/src/y.ts b/src/y.ts
index 1111111..2222222 100644
--- a/src/y.ts
+++ b/src/y.ts
@@ -1,4 +1,5 @@ export function g() {
 a
-b
+B
+C
 c
-d
+D
diff --git a/alt.ts b/neu.ts
similarity index 80%
rename from alt.ts
rename to neu.ts
index 3333333..4444444 100644
--- a/alt.ts
+++ b/neu.ts
@@ -1 +1 @@
-x
+y
diff --git a/e.txt b/e.txt
index 5555555..6666666 100644
--- a/e.txt
+++ b/e.txt
@@ -1,2 +1,2 @@
 a
-b
\\ No newline at end of file
+c
\\ No newline at end of file
diff --git a/bild.png b/bild.png
index 7777777..8888888 100644
Binary files a/bild.png and b/bild.png differ
`;
  const files = parseDiff(mixed);
  assert.equal(files.length, 4);
  for (const f of files) assert.deepEqual(parseDiff(fileDiff(f)), [f]);
  assert.deepEqual(stat(files[0]), { a: 3, d: 2 });
  assert.deepEqual(stat(files[3]), { a: 0, d: 0 });
});

test("reviewPrompt: sortiert nach Datei, dann Zeile numerisch", () => {
  assert.equal(
    reviewPrompt({
      "src/b.ts:3": { text: "Name?", lines: ["+let x"] },
      "src/a.ts:10": { text: "zu lang", lines: ["-alt", "+neu"] },
      "src/a.ts:9": { text: "Tippfehler", lines: ["+Fehelr"] },
    }),
    "src/a.ts:9 – Tippfehler\n```diff\n+Fehelr\n```\n\n" +
      "src/a.ts:10 – zu lang\n```diff\n-alt\n+neu\n```\n\n" +
      "src/b.ts:3 – Name?\n```diff\n+let x\n```",
  );
  assert.equal(reviewPrompt({}), "");
});
