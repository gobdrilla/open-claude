import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, groupKey, moveGroup, moveTab, swapIndex, urgent } from "./sessiontabs.logic.ts";

const s = (id: string, path: string, extra: { group?: string; guest?: string } = {}) => ({ id, repo: { path }, ...extra });
const shape = (g: ReturnType<typeof arrange>) => g.map((x) => x.list.map((y) => y.id).join(""));

test("groupKey: project, repo group, guests alone", () => {
  assert.equal(groupKey(s("a", "/p")), "r:/p");
  assert.equal(groupKey(s("a", "/p", { group: "G" })), "g:G");
  assert.equal(groupKey(s("a", "", { guest: "t" })), "x:a");
  assert.notEqual(groupKey(s("a", "", { guest: "t" })), groupKey(s("b", "", { guest: "t" })));
});

test("arrange groups by project, keeps the user order, new tabs at the end of their group", () => {
  const all = [s("a", "/p"), s("b", "/q"), s("c", "/p"), s("d", "/r")];
  assert.deepEqual(shape(arrange(all, [])), ["ac", "b", "d"]);
  // User put q first and c before a.
  assert.deepEqual(shape(arrange(all, ["b", "c", "a", "d"])), ["b", "ca", "d"]);
  // e is new in p: after c and a, not at the end of the strip.
  assert.deepEqual(shape(arrange([...all, s("e", "/p")], ["b", "c", "a", "d"])), ["b", "cae", "d"]);
  // Stale ids of closed sessions do no harm.
  assert.deepEqual(shape(arrange(all, ["x", "d", "y"])), ["d", "ac", "b"]);
});

test("moveGroup and moveTab never mix projects", () => {
  const g = arrange([s("a", "/p"), s("c", "/p"), s("b", "/q"), s("d", "/r")], []);
  assert.deepEqual(moveGroup(g, "r:/p", 2), ["b", "d", "a", "c"]);
  assert.deepEqual(moveGroup(g, "r:/r", 0), ["d", "a", "c", "b"]);
  assert.deepEqual(moveGroup(g, "r:/q", 99), ["a", "c", "d", "b"]);
  assert.deepEqual(moveTab(g, "a", 1), ["c", "a", "b", "d"]);
  // Out of range stays inside the group.
  assert.deepEqual(moveTab(g, "c", -5), ["c", "a", "b", "d"]);
  assert.deepEqual(moveTab(g, "a", 99), ["c", "a", "b", "d"]);
});

test("urgent: waiting before working before done", () => {
  assert.equal(urgent(["done", "run", undefined]), "run");
  assert.equal(urgent(["done", "ask", "run"]), "ask");
  assert.equal(urgent([undefined, undefined]), undefined);
});

test("swapIndex only past the neighbour's middle", () => {
  const mids = [10, 50, 200];
  assert.equal(swapIndex(mids, 0, 40), 0);
  assert.equal(swapIndex(mids, 0, 51), 1);
  assert.equal(swapIndex(mids, 1, 9), 0);
  assert.equal(swapIndex(mids, 2, 201), 2);
});
