import { test } from "node:test";
import assert from "node:assert/strict";
import { age, altKey, cn } from "./utils.ts";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

test("age: Einheiten und Grenzen", () => {
  assert.equal(age(""), "");
  assert.equal(age(ago(10e3)), "jetzt");
  assert.equal(age(ago(-60e3)), "jetzt"); // Uhr des Servers voraus
  assert.equal(age(ago(5 * 6e4)), "5 min");
  assert.equal(age(ago(3 * 36e5)), "3 h");
  assert.equal(age(ago(2 * 864e5)), "2 T");
  assert.equal(age(ago(62 * 864e5)), "2 Mo");
  assert.equal(age(ago(800 * 864e5)), "2 J");
  // abgerundet, nicht gerundet: 350 Tage sind "11 Mo", 1,6 Jahre sind "1 J"
  assert.equal(age(ago(350 * 864e5)), "11 Mo");
  assert.equal(age(ago(1.6 * 31536e6)), "1 J");
  assert.equal(age("2024-01-01T10:00:00+02:00").endsWith(" J") || age("2024-01-01T10:00:00+02:00").endsWith(" Mo"), true);
});

test("cn: Tailwind-Konflikte loest der letzte Wert", () => {
  assert.equal(cn("p-2", false && "x", "p-4"), "p-4");
});

const k = (key: string, code: string, m: Partial<KeyboardEvent> = {}) => ({ key, code, altKey: true, ctrlKey: false, metaKey: false, ...m }) as KeyboardEvent;
test("altKey: Windows, US-Mac-Tottaste; € und AltGr bleiben Eingabe", () => {
  assert.ok(altKey(k("e", "KeyE"), "e")); // Windows/Linux
  assert.ok(altKey(k("Dead", "KeyE"), "e")); // US-Mac
  assert.ok(!altKey(k("€", "KeyE"), "e")); // de-Mac: Eingabe
  assert.ok(!altKey(k("©", "KeyG"), "g"));
  assert.ok(!altKey(k("e", "KeyE", { ctrlKey: true }), "e")); // AltGr
  assert.ok(altKey(k("G", "KeyG"), "g"));
});
