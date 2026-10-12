import { test } from "node:test";
import assert from "node:assert/strict";
import { modeOf } from "./claudemode.ts";

test("modeOf", () => {
  assert.equal(modeOf(["❯ ", "  ▸▸ auto mode on (shift+tab to cycle)"]), "auto");
  assert.equal(modeOf(["❯ hallo", "  ⏸ plan mode on (shift+tab to cycle)"]), "plan");
  assert.equal(modeOf(["❯ ", "  ? for shortcuts"]), "default");
  // Dialog offen, keine Eingabezeile: unbekannt statt falsch Manuell
  assert.equal(modeOf(["  Manage MCP servers", "  Esc to close"]), undefined);
});
