import { test } from "node:test";
import assert from "node:assert/strict";
import { chunks, tally } from "./activity.logic.ts";

const t = (tool: string) => ({ kind: "tool", tool });
const x = { kind: "text", tool: "" };

test("chunks: Tool-Folgen gruppiert, Text trennt", () => {
  const p = { kind: "prompt", tool: "" };
  assert.deepEqual(chunks([p, t("Read"), t("Bash"), x, t("Edit")]), [{ e: p }, { tools: [t("Read"), t("Bash")] }, { e: x }, { tools: [t("Edit")] }]);
  assert.deepEqual(chunks([]), []);
  assert.deepEqual(chunks([x, x]), [{ e: x }, { e: x }]);
});

test("chunks: 5000 Tools in einer Gruppe, schnell", () => {
  const log = Array.from({ length: 5000 }, (_, i) => (i % 500 === 499 ? x : t("Read")));
  const s = performance.now();
  const c = chunks(log);
  assert.ok(performance.now() - s < 50);
  assert.equal(c.length, 20);
  assert.equal(c[0].tools?.length, 499);
});

test("tally: häufigste zuerst, MCP-Präfix weg", () => {
  assert.equal(tally([t("Read"), t("Bash"), t("Read"), t("mcp__brain__recall")]), "Read ×2, Bash, recall");
  assert.equal(tally([]), "");
});
