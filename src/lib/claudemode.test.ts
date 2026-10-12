import { test } from "node:test";
import assert from "node:assert/strict";
import { modeOf, tabState } from "./claudemode.ts";

test("modeOf", () => {
  assert.equal(modeOf(["❯ ", "  ▸▸ auto mode on (shift+tab to cycle)"]), "auto");
  assert.equal(modeOf(["❯ hallo", "  ⏸ plan mode on (shift+tab to cycle)"]), "plan");
  assert.equal(modeOf(["❯ ", "  ? for shortcuts"]), "default");
  // Dialog offen, keine Eingabezeile: unbekannt statt falsch Manuell
  assert.equal(modeOf(["  Manage MCP servers", "  Esc to close"]), undefined);
});

test("tabState", () => {
  assert.equal(tabState(undefined, { busy: true }, true), "run");
  assert.equal(tabState("run", { busy: false, waiting: true }, true), "ask");
  // fertig, aber gerade angesehen: kein Hinweis
  assert.equal(tabState("run", { busy: false }, true), undefined);
  assert.equal(tabState("run", { busy: false }, false), "done");
  assert.equal(tabState("done", { busy: false }, false), "done");
  assert.equal(tabState("done", { busy: false }, true), undefined);
  // Rueckfrage beantwortet ohne neuen Turn (abgelehnt): nicht als fertig melden
  assert.equal(tabState("ask", { busy: false }, false), undefined);
  assert.equal(tabState(undefined, null, false), undefined);
});
