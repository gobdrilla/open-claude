// Bracket colors without bracket tokens: legacy stream modes and files opened without a grammar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { StreamLanguage, ensureSyntaxTree } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { bracketClasses, bracketColors } from "./components/editor/bracketColors.ts";

const classes = (state: EditorState, from = 0, to = state.doc.length) =>
  bracketClasses(state, from, to).map(([pos, cls]) => `${state.doc.sliceString(pos, pos + 1)}${cls.slice(11)}`);

test("plain text: depth by nesting, stray close uncolored", () => {
  const state = EditorState.create({ doc: "f(a[b{c}]) ]", extensions: bracketColors });
  assert.deepEqual(classes(state), ["(0", "[1", "{2", "}2", "]1", ")0"]);
});

test("stream mode: brackets in strings and comments are skipped", () => {
  const doc = 'f() { echo "(x" # )\n  a=$(b [c])\n}';
  const state = EditorState.create({ doc, extensions: [StreamLanguage.define(shell), bracketColors] });
  ensureSyntaxTree(state, doc.length, 1000);
  assert.deepEqual(classes(state), ["(0", ")0", "{0", "(1", "[2", "]2", ")1", "}0"]);
});

test("depth at a later range comes from the text before it, also after an edit above", () => {
  const head = "{".repeat(3) + "\n" + "x\n".repeat(40000);
  let state = EditorState.create({ doc: head + "()", extensions: bracketColors });
  assert.deepEqual(classes(state, head.length), ["(0", ")0"]);
  state = state.update({ changes: { from: 0, insert: "[" } }).state;
  assert.deepEqual(classes(state, head.length + 1), ["(1", ")1"]);
  state = state.update({ changes: { from: 0, to: 2 } }).state;
  assert.deepEqual(classes(state, head.length - 1), ["(2", ")2"]);
});
