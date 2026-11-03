import { test } from "node:test";
import assert from "node:assert/strict";
import { byFolder, chunks, folderOf, tally } from "./activity.logic.ts";

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

test("byFolder: Ordner mit mehr als 10 Dateien als eigene Gruppe", () => {
  const f = (p: string) => ({ kind: "file", label: p });
  const paste = { kind: "paste", label: "Eingefügt #1" };
  const read = { kind: "read", label: "/s/a.png" };
  const series = Array.from({ length: 11 }, (_, i) => f(`/s/out/${i}.png`));
  const few = Array.from({ length: 10 }, (_, i) => f(`C:\\w\\${i}.png`));
  const g = byFolder([paste, series[0], read, ...few, ...series.slice(1)]);
  assert.deepEqual(g, [["", [paste, read, ...few]], ["/s/out", series]]);
  assert.deepEqual(byFolder([]), [["", []]]);
  assert.equal(folderOf("C:\\w\\a.png"), "C:\\w");
  assert.equal(folderOf("a.png"), "");
});

test("byFolder: 5000 Dateien schnell", () => {
  const imgs = Array.from({ length: 5000 }, (_, i) => ({ kind: "file", label: `/d${i % 7}/${i}.png` }));
  const s = performance.now();
  const g = byFolder(imgs);
  assert.ok(performance.now() - s < 50);
  assert.equal(g.length, 8);
});
