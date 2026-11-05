import { test } from "node:test";
import assert from "node:assert/strict";
import { LANG, en, systemLang, t } from "./i18n.ts";
import editor from "./i18n/en/editor.ts";
import git from "./i18n/en/git.ts";
import app from "./i18n/en/app.ts";
import panels from "./i18n/en/panels.ts";
import misc from "./i18n/en/misc.ts";
import logic from "./i18n/en/logic.ts";

test("system language: German only for German locales", () => {
  assert.equal(systemLang(["de-DE", "en-US"]), "de");
  assert.equal(systemLang(["de-AT"]), "de");
  assert.equal(systemLang(["en-GB", "de-DE"]), "en");
  assert.equal(systemLang(["fr-FR"]), "en");
  assert.equal(systemLang([]), "en");
});

test("t stays German under node, fills placeholders", () => {
  assert.equal(LANG, "de");
  assert.equal(t("{n} ungespeichert", { n: 3 }), "3 ungespeichert");
  assert.equal(t("Kein Eintrag dafür"), "Kein Eintrag dafür");
  assert.equal(en("Kein Eintrag dafür {x}", { x: 1 }), "Kein Eintrag dafür 1", "missing entry falls back to German");
});

test("every English text keeps the placeholders of its German key", () => {
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const all = [editor, git, app, panels, misc, logic];
  const seen = new Map<string, string>();
  for (const d of all)
    for (const [de, text] of Object.entries(d as Record<string, string>)) {
      assert.equal(ph(text), ph(de), `placeholders differ: ${JSON.stringify(de)} -> ${JSON.stringify(text)}`);
      assert.ok(text.trim(), `empty translation for ${JSON.stringify(de)}`);
      const prev = seen.get(de);
      assert.ok(prev === undefined || prev === text, `two translations for ${JSON.stringify(de)}: ${prev} / ${text}`);
      seen.set(de, text);
    }
});
