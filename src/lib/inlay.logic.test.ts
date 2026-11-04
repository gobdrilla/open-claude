import { test } from "node:test";
import assert from "node:assert/strict";
import { inlayLabel, inlaySide } from "./inlay.logic.ts";

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
