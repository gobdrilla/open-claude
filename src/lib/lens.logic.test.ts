import { test } from "node:test";
import assert from "node:assert/strict";
import { headline, worse, type Severity } from "./lens.logic.ts";

const d = (severity: Severity, id: number) => ({ severity, id });

test("worse keeps the most severe, first on a tie", () => {
  const w = d("warning", 1);
  const e = d("error", 2);
  const e2 = d("error", 3);
  const i = d("info", 4);
  assert.equal(worse(undefined, i), i);
  assert.equal(worse(i, w), w);
  assert.equal(worse(w, e), e);
  assert.equal(worse(e, w), e);
  assert.equal(worse(e, e2), e);
  assert.equal(worse(i, d("hint", 5)), i);
});

test("headline takes the first non-empty line", () => {
  assert.equal(headline("expected `;`\nfound `}`"), "expected `;`");
  assert.equal(headline("\n  \n  Type mismatch  \nmore"), "Type mismatch");
  assert.equal(headline(""), "");
});
