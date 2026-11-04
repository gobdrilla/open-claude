import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSuggestion, prefixes, ticketFromBranch, withPrefix, withTicket } from "./commitmsg.logic.ts";

test("ticketFromBranch: Schlüssel aus dem Branch, sonst null", () => {
  assert.equal(ticketFromBranch("feature/ABC-123-foo"), "ABC-123");
  assert.equal(ticketFromBranch("feature/abc-123-foo"), "ABC-123");
  assert.equal(ticketFromBranch("bugfix/abc-42"), "ABC-42");
  assert.equal(ticketFromBranch("PROJ2-7"), "PROJ2-7");
  assert.equal(ticketFromBranch("main"), null);
  assert.equal(ticketFromBranch("release/1.2"), null);
  assert.equal(ticketFromBranch("v1-2"), null);
  assert.equal(ticketFromBranch(null), null);
});

test("prefixes: häufigste Typen ab 2, nur bei genug konventionellen Betreffs", () => {
  const s = [...Array(6).fill("feat: a"), ...Array(3).fill("fix: b"), "Merge branch x"];
  assert.deepEqual(prefixes(s), ["feat", "fix"]);
  assert.deepEqual(prefixes(["feat: a", "feat: b", ...Array(8).fill("misc")]), []);
  assert.deepEqual(prefixes(["feat(git)!: x", "feat: y", "chore: z"]), ["feat"]);
  assert.deepEqual(prefixes(["a: 1", "a: 2", "b: 1", "b: 2", "c: 1", "c: 2", "d: 1", "d: 2", "e: 1", "e: 2", "e: 3"]), ["e", "a", "b", "c"]);
  assert.deepEqual(prefixes([]), []);
});

test("withPrefix: ersetzt vorhandenen Typ, nur in Zeile 1", () => {
  assert.equal(withPrefix("fix: a", "feat: "), "feat: a");
  assert.equal(withPrefix("fix(ui)!: a", "feat: "), "feat: a");
  assert.equal(withPrefix("", "feat: "), "feat: ");
  assert.equal(withPrefix("a\n\nfix: b", "feat: "), "feat: a\n\nfix: b");
});

test("withTicket: einmal, hinter einem Typ", () => {
  assert.equal(withTicket("", "ABC-1"), "ABC-1 ");
  assert.equal(withTicket("feat: x", "ABC-1"), "feat: ABC-1 x");
  assert.equal(withTicket(withTicket("x", "ABC-1"), "ABC-1"), "ABC-1 x");
  assert.equal(withTicket("abc-1 x", "ABC-1"), "abc-1 x");
  assert.equal(withTicket("x\n\nABC-1", "ABC-1"), "ABC-1 x\n\nABC-1");
  assert.equal(withPrefix(withTicket("", "ABC-1"), "feat: "), "feat: ABC-1 ");
});

test("cleanSuggestion: <NONE> und Kommentarzeilen fallen weg", () => {
  assert.equal(cleanSuggestion(" <NONE>\n"), "");
  assert.equal(cleanSuggestion(""), "");
  assert.equal(cleanSuggestion("feat: x\n\n- y\n# Please enter"), "feat: x\n\n- y");
});
