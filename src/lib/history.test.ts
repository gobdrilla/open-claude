import { test } from "node:test";
import assert from "node:assert/strict";
import { DAYS, KEEP, prune } from "./history.ts";

test("prune keeps the newest KEEP within DAYS, never the newest one", () => {
  const now = 1_000 * 86_400_000;
  const day = 86_400_000;
  const many = Array.from({ length: KEEP + 3 }, (_, i) => ({ id: i + 1, time: now - i * 1000 }));
  assert.deepEqual(prune(many, now).sort((a, b) => a - b), [KEEP + 1, KEEP + 2, KEEP + 3]);
  const old = [
    { id: 1, time: now - (DAYS + 5) * day },
    { id: 2, time: now - (DAYS + 1) * day },
    { id: 3, time: now - day },
  ];
  assert.deepEqual(prune(old, now).sort(), [1, 2]);
  assert.deepEqual(prune([{ id: 9, time: now - 400 * day }], now), [], "the only version stays however old");
  assert.deepEqual(prune([], now), []);
});
