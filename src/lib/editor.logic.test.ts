import { test } from "node:test";
import assert from "node:assert/strict";
import { abs, rel, ancestors, atRef, cite, devUrl, ghostText, gutterMarks, huge, moved, packageManager, pasteFrame, plain, pushNav, serverUrl, span, under, verdict } from "./editor.logic.ts";
import { parseDiff } from "./diff.ts";

test("unveraenderte Platte: nichts tun, egal ob lokal geaendert", () => {
  assert.equal(verdict(false, 5, 5), "none");
  assert.equal(verdict(true, 5, 5), "none");
  // "Meine behalten" nach dem Loeschen setzt mtime auf null: kein neuer Konflikt, solange die Datei fehlt.
  assert.equal(verdict(true, null, null), "none");
});

test("ohne lokale Aenderungen: still nachladen bzw. Tab schliessen", () => {
  assert.equal(verdict(false, 5, 6), "reload");
  assert.equal(verdict(false, 5, 4), "reload"); // aeltere mtime (git checkout) zaehlt auch
  assert.equal(verdict(false, 5, null), "close");
  assert.equal(verdict(false, null, 7), "reload");
});

test("mit lokalen Aenderungen: nur Konflikt melden", () => {
  assert.equal(verdict(true, 5, 6), "changed");
  assert.equal(verdict(true, 5, null), "deleted");
  assert.equal(verdict(true, null, 7), "changed");
});

test("under trifft Datei und Ordnerinhalt, aber keine Namensvettern", () => {
  assert.ok(under("src/a.ts", "src/a.ts"));
  assert.ok(under("src/a.ts", "src"));
  assert.ok(!under("src2/a.ts", "src"));
  assert.ok(!under("src", "src/a.ts"));
});

test("moved zieht Datei und Ordnerinhalt mit", () => {
  assert.equal(moved("a.ts", "a.ts", "b.ts"), "b.ts");
  assert.equal(moved("src/x/a.ts", "src", "lib"), "lib/x/a.ts");
  assert.equal(moved("src2/a.ts", "src", "lib"), null);
});

test("span ersetzt nur die geaenderte Mitte", () => {
  const apply = (a: string, b: string) => {
    const { from, to, insert } = span(a, b);
    return a.slice(0, from) + insert + a.slice(to);
  };
  assert.deepEqual(span("eins\nzwei\ndrei", "eins\nZWEI\ndrei"), { from: 5, to: 9, insert: "ZWEI" });
  assert.deepEqual(span("abc", "abc"), { from: 3, to: 3, insert: "" });
  assert.deepEqual(span("aa", "aaa"), { from: 2, to: 2, insert: "a" });
  assert.deepEqual(span("aaa", "aa"), { from: 2, to: 3, insert: "" });
  for (const [a, b] of [["", "x"], ["x", ""], ["abab", "ab"], ["ab", "abab"], ["xay", "xby"], ["a\n", "b\n"], ["ab", "ba"]])
    assert.equal(apply(a, b), b, `${a} -> ${b}`);
});

test("devUrl: nur http(s), Schema wird ergaenzt", () => {
  assert.equal(devUrl("  "), "");
  assert.equal(devUrl("localhost:5173"), "http://localhost:5173/");
  assert.equal(devUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(devUrl("javascript:alert(1)"), null);
  assert.equal(devUrl("file:///etc/passwd"), null);
  assert.equal(devUrl("http://"), null);
});

test("serverUrl: erste lokale Adresse aus dem Output, ohne ANSI", () => {
  // Vite setzt den Port fett, mitten in die URL.
  const vite =
    "\r\n  \x1b[32m\x1b[1mVITE\x1b[22m v8.3.0\x1b[39m  ready\r\n\r\n  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5174\x1b[22m/\x1b[39m\r\n";
  assert.equal(serverUrl(plain(vite)), "http://localhost:5174/");
  assert.equal(serverUrl(plain("   - Local:        http://localhost:3000\n")), "http://localhost:3000/");
  assert.equal(serverUrl(plain(" ┃ Local    https://127.0.0.1:4321/app\n")), "https://127.0.0.1:4321/app");
  assert.equal(serverUrl(plain("listening on http://0.0.0.0:8080\n")), "http://localhost:8080/");
  assert.equal(serverUrl(plain("http://[::1]:5173/\n")), "http://[::1]:5173/");
  assert.equal(serverUrl(plain("\x1b[2J\x1b[3J\x1b[H\x1b]0;title\x07ok http://localhost:1/ \n")), "http://localhost:1/");
  // Mitten im Port abgeschnitten: noch nicht.
  assert.equal(serverUrl(plain("Local: http://localhost:51")), null);
  // Fremde Hosts nie, auch nicht als Praefix getarnt.
  assert.equal(serverUrl(plain("Network: http://192.168.1.5:5173/\n")), null);
  assert.equal(serverUrl(plain("http://localhost.evil.com/ \n")), null);
  assert.equal(serverUrl(plain("http://localhost@evil.com/ \n")), null);
  // Satzzeichen, Klammern und Zeichensatz-Sequenzen hinter der Adresse gehoeren nicht dazu.
  assert.equal(serverUrl(plain("Loopback: http://localhost:8080/, http://[::1]:8080/\n")), "http://localhost:8080/");
  assert.equal(serverUrl(plain("Server listening on http://localhost:3000.\n")), "http://localhost:3000/");
  assert.equal(serverUrl(plain("ready (http://localhost:3000)\n")), "http://localhost:3000/");
  assert.equal(serverUrl(plain('open "http://localhost:3000/a.b"\n')), "http://localhost:3000/a.b");
  assert.equal(serverUrl(plain("http://localhost:5173/\x1b(B\x1b[m\n")), "http://localhost:5173/");
  // Die Zeile mit "Local" gewinnt gegen eine fruehere Proxy-Zeile.
  const proxy = "[proxy] /api -> http://localhost:8000 \n";
  assert.equal(serverUrl(proxy + "  Local: http://localhost:5173/\n"), "http://localhost:5173/");
  assert.equal(serverUrl(proxy), "http://localhost:8000/");
  assert.equal(serverUrl(proxy, true), null);
});

test("packageManager, ancestors", () => {
  assert.equal(packageManager('{"packageManager":"pnpm@9.1.0+sha"}', ["yarn.lock"]), "pnpm");
  assert.equal(packageManager("{}", ["package-lock.json", "yarn.lock"]), "yarn");
  assert.equal(packageManager("kaputt", ["bun.lockb"]), "bun");
  assert.equal(packageManager("{}", []), "npm");
  assert.deepEqual(ancestors("apps/web/src/App.vue"), ["apps/web/src", "apps/web", "apps", ""]);
  assert.deepEqual(ancestors("a.ts"), [""]);
  assert.deepEqual(ancestors(""), [""]);
});

test("huge: Groesse und minifizierte Zeilen", () => {
  assert.equal(huge("a\n".repeat(1000)), false);
  assert.equal(huge("x".repeat(1_000_001)), true);
  assert.equal(huge("a\n" + "x".repeat(10_000) + "\n"), true);
  assert.equal(huge(("x".repeat(9_999) + "\n").repeat(50)), false);
});

test("Pfade zwischen claude (absolut) und Editor (relativ)", () => {
  assert.equal(rel("/home/a/repo", "/home/a/repo/src/x.ts"), "src/x.ts");
  assert.equal(rel("/home/a/repo/", "/home/a/repo/x"), "x");
  assert.equal(rel("/home/a/repo", "./src/x.ts"), "src/x.ts");
  assert.equal(rel("/home/a/repo", "/home/a/repo2/x"), "/home/a/repo2/x");
  assert.equal(rel("C:\\Dev\\repo", "c:\\dev\\repo\\src\\x.ts"), "src/x.ts");
  assert.equal(abs("/home/a/repo", "src/x.ts"), "/home/a/repo/src/x.ts");
  assert.equal(abs("C:\\Dev\\repo\\", "src/x.ts"), "C:\\Dev\\repo\\src\\x.ts");
});

test("pushNav: keine direkten Duplikate, hoechstens max", () => {
  const a = { path: "a.ts", line: 3, col: 0 };
  let st = pushNav([], a);
  assert.deepEqual(pushNav(st, { ...a, col: 5 }), st);
  st = pushNav(st, { path: "b.ts", line: 3, col: 0 });
  assert.equal(pushNav(st, a).length, 3);
  for (let i = 0; i < 60; i++) st = pushNav(st, { path: "c.ts", line: i, col: 0 });
  assert.equal(st.length, 50);
  assert.equal(st.at(-1)!.line, 59);
  assert.equal(pushNav(st, a, 5).length, 5);
});

test("gutterMarks: neu, geaendert, geloescht am Anfang und am Ende", () => {
  const marks = (...hunks: string[]) =>
    gutterMarks(parseDiff(`diff --git a/x b/x\n--- a/x\n+++ b/x\n${hunks.join("\n")}\n`)[0].hunks);
  assert.deepEqual(marks("@@ -0,0 +1,2 @@\n+a\n+b"), [
    { line: 1, kind: "add" },
    { line: 2, kind: "add" },
  ]);
  assert.deepEqual(marks("@@ -2 +2 @@\n-a\n+b", "@@ -9,0 +10 @@\n+z"), [
    { line: 2, kind: "mod" },
    { line: 10, kind: "add" },
  ]);
  // Geloescht ganz oben: erste Zeile; am Ende: letzte verbliebene.
  assert.deepEqual(marks("@@ -1 +0,0 @@\n-a"), [{ line: 1, kind: "del" }]);
  assert.deepEqual(marks("@@ -5,2 +4,0 @@\n-a\n-b"), [{ line: 4, kind: "del" }]);
});

test("pasteFrame: Rahmen, kein \\r am Ende, Rahmen-Sequenzen im Text entfernt", () => {
  assert.equal(pasteFrame("@a.ts "), "\x1b[200~@a.ts \x1b[201~");
  assert.equal(pasteFrame("x\x1b[201~\ry\x1b[200~"), "\x1b[200~x\ny\x1b[201~");
  assert.equal(pasteFrame("a\r\nb\rc\n"), "\x1b[200~a\nb\nc\n\x1b[201~");
  assert.ok(!pasteFrame("a\r").includes("\r"));
  assert.equal(pasteFrame("a\x1b[20\x1b[201~1~b"), "\x1b[200~a[201~b\x1b[201~");
  assert.equal(pasteFrame("a\tb\x03\x7fc"), "\x1b[200~a\tbc\x1b[201~");
});

test("pasteFrame kuerzt ab 20000 Zeichen", () => {
  const f = pasteFrame("x".repeat(25000));
  assert.ok(f.endsWith("… [gekürzt]\x1b[201~"));
  assert.equal(f.length, 6 + 20000 + "… [gekürzt]".length + 6);
});

test("atRef und cite", () => {
  assert.equal(atRef("src/a.ts", "#L2-4"), "@src/a.ts#L2-4 ");
  assert.equal(atRef("my dir/a.ts"), '@"my dir/a.ts" ');
  assert.equal(cite("\neins   \r\nzwei  \n\n"), "> eins\n> zwei\n");
});

test("ghostText: Markdown weg, <NONE> und Leeres sind kein Vorschlag", () => {
  assert.equal(ghostText("```ts\na + b\n```", ""), "a + b");
  assert.equal(ghostText("<NONE>", ""), "");
  assert.equal(ghostText("  \n", ""), "");
});

test("ghostText: was hinter dem Cursor schon steht, faellt hinten weg", () => {
  assert.equal(ghostText("a + b }", " }"), "a + b");
  assert.equal(ghostText("name)", ")"), "name");
  // Nur der Rest der Zeile: sonst bleibt alles, auch fuehrende Leerzeichen
  assert.equal(ghostText(" + 1", ""), " + 1");
  assert.equal(ghostText("}", "}"), "");
  assert.equal(ghostText("i++) {", ""), "i++) {");
});
