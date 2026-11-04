import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, blameLabel, blameTitle, uncommitted } from "./blame.logic.ts";

const NOW = 1_800_000_000;
const c = (sha: string, ageS: number) => ({ sha, author: "Anna Beispiel", time: NOW - ageS, summary: "fix: Login" });

test("relative Zeit auf Deutsch", () => {
  assert.equal(ago(NOW - 10, NOW), "gerade eben");
  assert.equal(ago(NOW - 5 * 60, NOW), "vor 5 Minuten");
  assert.equal(ago(NOW - 3600, NOW), "vor 1 Stunde");
  assert.equal(ago(NOW - 3 * 86400 - 5, NOW), "vor 3 Tagen");
  assert.equal(ago(NOW - 14 * 86400, NOW), "vor 2 Wochen");
  assert.equal(ago(NOW - 65 * 86400, NOW), "vor 2 Monaten");
  assert.equal(ago(NOW - 800 * 86400, NOW), "vor 2 Jahren");
  // Clock skew (commit in the future): no "in 5 Minuten".
  assert.equal(ago(NOW + 300, NOW), "gerade eben");
});

test("Blame-Text und Tooltip", () => {
  const sha = "a".repeat(40);
  assert.equal(blameLabel(c(sha, 3 * 86400), NOW), "Anna Beispiel, vor 3 Tagen • fix: Login");
  assert.ok(blameTitle(c(sha, 0)).startsWith(sha + "\nAnna Beispiel · "));
  assert.ok(blameTitle(c(sha, 0)).includes("fix: Login"));
  const zero = c("0".repeat(40), 0);
  assert.ok(uncommitted(zero) && !uncommitted(c(sha, 0)));
  assert.equal(blameLabel(zero, NOW), "Noch nicht committet");
});
