import { test } from "node:test";
import assert from "node:assert/strict";
import { pairBrackets, type Bracket } from "./brackets.logic.ts";

const seq = (s: string): Bracket[] => [...s].map((ch, from) => ({ ch, from }));

test("depth per nesting level, closing bracket gets the depth of its open", () => {
  assert.deepEqual(pairBrackets(seq("({[]})()"), []), [0, 1, 2, 2, 1, 0, 0, 0]);
});

test("close without open or of the wrong kind is unmatched and does not pop", () => {
  const stack: Bracket[] = [];
  assert.deepEqual(pairBrackets(seq(")(]"), stack), [-1, 0, -1]);
  assert.deepEqual(
    stack.map((b) => b.ch),
    ["("],
  );
});

test("opens left over stay on the stack", () => {
  const stack: Bracket[] = [];
  assert.deepEqual(pairBrackets(seq("{(()"), stack), [0, 1, 2, 2]);
  assert.deepEqual(
    stack.map((b) => b.from),
    [0, 1],
  );
});

test("seeded stack: brackets before the viewport set the depth and close later", () => {
  const stack = [
    { ch: "{", from: 0 },
    { ch: "(", from: 5 },
  ];
  assert.deepEqual(
    pairBrackets(
      [
        { ch: "[", from: 10 },
        { ch: "]", from: 11 },
        { ch: ")", from: 12 },
        { ch: "}", from: 13 },
      ],
      stack,
    ),
    [2, 2, 1, 0],
  );
  assert.deepEqual(stack, []);
});
