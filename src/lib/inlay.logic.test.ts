import { test } from "node:test";
import assert from "node:assert/strict";
import { INIT_OPTIONS, initOptions, inlayLabel, inlaySide } from "./inlay.logic.ts";

test("initOptions: typescript gets the svelte plugin from the LSP folder, others unchanged", () => {
  const ts = initOptions("typescript", "C:\\x\\lsp") as { preferences: unknown; plugins: unknown };
  assert.deepEqual(ts.plugins, [{ name: "typescript-svelte-plugin", location: "C:\\x\\lsp" }]);
  assert.deepEqual(ts.preferences, (INIT_OPTIONS.typescript as { preferences: unknown }).preferences);
  assert.equal(initOptions("rust", "/l"), INIT_OPTIONS.rust);
  assert.equal(initOptions("go", "/l"), undefined);
});

test("inlay label: string as is, parts joined", () => {
  assert.equal(inlayLabel(": number"), ": number");
  assert.equal(inlayLabel([{ value: ": " }, { value: "Vec" }, { value: "<u8>" }]), ": Vec<u8>");
  assert.equal(inlayLabel([]), "");
});

test("inlay side: parameter hints left of typed text, others right", () => {
  const position = { line: 0, character: 0 };
  assert.equal(inlaySide({ position, label: "a:", kind: 2 }), -1);
  assert.equal(inlaySide({ position, label: ": T", kind: 1 }), 1);
  assert.equal(inlaySide({ position, label: "x" }), 1);
});
