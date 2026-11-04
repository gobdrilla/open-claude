import { test } from "node:test";
import assert from "node:assert/strict";
import { nearest, runs } from "./ruler.logic.ts";

test("runs merges touching and overlapping marks, unsorted input", () => {
  assert.deepEqual(runs([]), []);
  assert.deepEqual(
    runs([
      [10, 12],
      [0, 2],
      [2, 4],
      [11, 15],
      [20, 22],
    ]),
    [
      [0, 4],
      [10, 15],
      [20, 22],
    ],
  );
  assert.deepEqual(
    runs([
      [0, 10],
      [3, 5],
    ]),
    [[0, 10]],
  );
});

test("nearest picks the closest target within tolerance", () => {
  assert.equal(nearest([], 5, 4), -1);
  assert.equal(nearest([10, 20, 30], 22, 4), 1);
  assert.equal(nearest([10, 20, 30], 25, 4), -1);
  assert.equal(nearest([10, 13], 12, 4), 1);
  assert.equal(nearest([10, 14], 12, 4), 0);
});
