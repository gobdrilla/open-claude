import { test } from "node:test";
import assert from "node:assert/strict";
import { moveRow, rebaseProblem, rebaseSteps, type RebaseRow } from "./rebase.logic.ts";

const row = (sha: string, op: RebaseRow["op"] = "pick", edit: string | null = null): RebaseRow => ({ sha, subject: sha, op, edit, orig: sha });

test("moveRow: tauscht Nachbarn, Ränder bleiben", () => {
  assert.deepEqual(moveRow([1, 2, 3], 0, 1), [2, 1, 3]);
  assert.deepEqual(moveRow([1, 2, 3], 2, -1), [1, 3, 2]);
  const a = [1, 2];
  assert.equal(moveRow(a, 0, -1), a);
  assert.equal(moveRow(a, 1, 1), a);
});

test("rebaseProblem: erster behaltener Commit darf kein fixup sein, Nachricht nicht leer", () => {
  assert.equal(rebaseProblem([row("a"), row("b", "fixup")]), null);
  assert.match(rebaseProblem([row("a", "fixup"), row("b")])!, /Erster/);
  assert.match(rebaseProblem([row("a", "drop"), row("b", "fixup")])!, /Erster/);
  assert.match(rebaseProblem([row("a", "pick", " \n")])!, /leer/);
  assert.equal(rebaseProblem([row("a", "drop", ""), row("b")]), null);
  assert.equal(rebaseProblem([row("a", "drop"), row("b", "drop")]), null);
});

test("rebaseSteps: nur geänderte Nachrichten, keine bei drop", () => {
  assert.deepEqual(rebaseSteps([row("a", "pick", "a"), row("b", "fixup", "neu"), row("c", "drop", "x")]), [
    { op: "pick", sha: "a", message: null },
    { op: "fixup", sha: "b", message: "neu" },
    { op: "drop", sha: "c", message: null },
  ]);
});
