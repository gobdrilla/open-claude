import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, editsOf, fileUri, flatSymbols, offsetAt, problems, projectScan, serverFor, uriPath } from "./lsp.logic.ts";

test("Server nach Endung, Gross-/Kleinschreibung egal", () => {
  assert.deepEqual(serverFor("src/App.TSX"), { server: "typescript", languageId: "typescriptreact" });
  assert.deepEqual(serverFor("a/b.svelte"), { server: "svelte", languageId: "svelte" });
  assert.equal(serverFor("README"), null);
  assert.equal(serverFor("ordner.rs/Makefile"), null);
  assert.equal(serverFor("x.unbekannt"), null);
});

test("file-URI und zurueck, Unix", () => {
  const repo = "/a/b c";
  assert.equal(fileUri(repo, "src/x y.ts"), "file:///a/b%20c/src/x%20y.ts");
  assert.equal(fileUri(repo, ""), "file:///a/b%20c");
  assert.equal(uriPath(repo, fileUri(repo, "src/x y.ts")), "src/x y.ts");
  assert.equal(uriPath(repo, "file:///a/b%20c2/x.ts"), null);
  assert.equal(uriPath(repo, "file:///a/b%20c"), null);
  assert.equal(uriPath(repo, "untitled:x"), null);
});

test("file-URI und zurueck, Windows mit c%3A", () => {
  const repo = "C:\\p q\\r";
  assert.equal(fileUri(repo, "src/x.ts"), "file:///C:/p%20q/r/src/x.ts");
  assert.equal(fileUri(repo, ""), "file:///C:/p%20q/r");
  assert.equal(uriPath(repo, "file:///C:/p%20q/r/src/x.ts"), "src/x.ts");
  assert.equal(uriPath(repo, "file:///c%3A/p%20q/r/src/x.ts"), "src/x.ts");
  assert.equal(uriPath(repo, "file:///D:/p%20q/r/x.ts"), null);
});

const r = (l1: number, c1: number, l2: number, c2: number) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });

test("Edits anwenden: mehrere pro Zeile, mehrzeilig, Emoji, Einfuegen", () => {
  assert.equal(applyEdits("foo(foo)\n", [{ range: r(0, 0, 0, 3), newText: "bar" }, { range: r(0, 4, 0, 7), newText: "bar" }]), "bar(bar)\n");
  assert.equal(applyEdits("a\nb\nc", [{ range: r(0, 1, 2, 0), newText: "-" }]), "a-c");
  assert.equal(applyEdits("😀 x", [{ range: r(0, 3, 0, 4), newText: "y" }]), "😀 y");
  assert.equal(applyEdits("ab", [{ range: r(0, 1, 0, 1), newText: "X" }]), "aXb");
  assert.equal(offsetAt("ab\ncd", { line: 9, character: 0 }), 5);
  assert.equal(offsetAt("ab\ncd", { line: 0, character: 99 }), 2);
});

test("problems: nur das Projekt, Fehler zuerst, dann Pfad und Zeile", () => {
  const d = (line: number, severity?: number) => ({ range: { start: { line, character: 0 } }, severity });
  const diags = {
    "/r\nb.ts": { list: [d(5, 2), d(1)] },
    "/r\na.ts": { list: [d(9, 1), d(3, 2)] },
    "/r2\na.ts": { list: [d(0, 1)] },
  };
  assert.deepEqual(
    problems(diags, "/r").map((p) => `${p.path}:${p.d.range.start.line}`),
    ["a.ts:9", "b.ts:1", "a.ts:3", "b.ts:5"],
  );
  assert.deepEqual(problems({}, "/r"), []);
});

test("flatSymbols: verschachtelte DocumentSymbols mit Container", () => {
  const r = (line: number, character: number) => ({ start: { line, character }, end: { line, character } });
  const syms = flatSymbols([
    {
      name: "A",
      kind: 5,
      selectionRange: r(1, 6),
      children: [{ name: "m", kind: 6, selectionRange: r(2, 2), children: [{ name: "x", kind: 13, selectionRange: r(3, 4) }] }],
    },
  ]);
  assert.deepEqual(
    syms.map((s) => [s.name, s.container, s.at.line, s.at.character]),
    [["A", "", 1, 6], ["m", "A", 2, 2], ["x", "A.m", 3, 4]],
  );
});

test("flatSymbols: SymbolInformation/WorkspaceSymbol, Range optional, null leer", () => {
  const syms = flatSymbols([
    { name: "f", kind: 12, containerName: "mod", location: { uri: "file:///a/x.rs", range: { start: { line: 4, character: 3 }, end: { line: 4, character: 4 } } } },
    { name: "g", kind: 12, location: { uri: "file:///a/y.rs" } },
  ]);
  assert.deepEqual(syms, [
    { name: "f", kind: 12, container: "mod", uri: "file:///a/x.rs", at: { line: 4, character: 3 } },
    { name: "g", kind: 12, container: "", uri: "file:///a/y.rs", at: { line: 0, character: 0 } },
  ]);
  assert.deepEqual(flatSymbols(null), []);
});

test("editsOf: changes, documentChanges, Datei-Operationen werfen", () => {
  const e = [{ range: r(0, 0, 0, 1), newText: "b" }];
  assert.deepEqual(editsOf(null), []);
  assert.deepEqual(editsOf({ changes: { "file:///a.ts": e } }), [{ uri: "file:///a.ts", edits: e }]);
  // documentChanges hat Vorrang vor changes.
  assert.deepEqual(editsOf({ changes: {}, documentChanges: [{ textDocument: { uri: "file:///b.ts", version: 1 }, edits: e }] }), [
    { uri: "file:///b.ts", edits: e },
  ]);
  assert.throws(() => editsOf({ documentChanges: [{ kind: "rename", oldUri: "file:///a", newUri: "file:///b" }] }), /Dateioperationen/);
});

test("projectScan: TS/Svelte/Python/C# oeffnen, Rust/Go nur starten, gedeckelt", () => {
  const files = ["a.ts", "b.svelte", "c.py", "d.cs", "e.rs", "f.go", "g.json", "h.css", "i.c", "README.md"];
  assert.deepEqual(projectScan(files), { open: ["a.ts", "b.svelte", "c.py", "d.cs"], start: ["rust", "go"], capped: 0 });
  assert.deepEqual(projectScan(["a.ts", "b.ts", "c.ts"], 2), { open: ["a.ts", "b.ts"], start: [], capped: 1 });
});
