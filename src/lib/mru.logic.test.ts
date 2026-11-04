import { test } from "node:test";
import assert from "node:assert/strict";
import { follow, step, touch } from "./mru.logic.ts";

test("touch moves the file to the front without duplicates", () => {
  assert.deepEqual(touch(["a", "b", "c"], "c"), ["c", "a", "b"]);
  assert.deepEqual(touch(["a", "b"], "a"), ["a", "b"]);
  assert.deepEqual(touch([], "x"), ["x"]);
});

test("follow renames files and folders in place and dedupes", () => {
  assert.deepEqual(follow(["src/a.ts", "b.ts", "src2/a.ts"], "src", "lib"), ["lib/a.ts", "b.ts", "src2/a.ts"]);
  assert.deepEqual(follow(["a.ts", "b.ts"], "a.ts", "b.ts"), ["b.ts"]);
});

test("step wraps both ways", () => {
  assert.equal(step(0, 3, false), 1);
  assert.equal(step(2, 3, false), 0);
  assert.equal(step(0, 3, true), 2);
  assert.equal(step(1, 3, true), 0);
  assert.equal(step(0, 2, false), 1);
  assert.equal(step(1, 2, false), 0);
});
