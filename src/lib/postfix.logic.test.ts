import { test } from "node:test";
import assert from "node:assert/strict";
import { fill, postfixAt, postfixLang, postfixes } from "./postfix.logic.ts";

test("postfixLang by extension", () => {
  assert.equal(postfixLang("src/a.ts"), "ts");
  assert.equal(postfixLang("App.tsx"), "ts");
  assert.equal(postfixLang("x.svelte"), "ts");
  assert.equal(postfixLang("Lab/Program.cs"), "cs");
  assert.equal(postfixLang("README.md"), null);
  assert.equal(postfixLang("main.rs"), null);
});

test("postfixAt takes the member chain before the dot", () => {
  assert.deepEqual(postfixAt("  shapes.fo"), { expr: "shapes", key: "fo" });
  assert.deepEqual(postfixAt("x = a.b(1, 2)[0].items."), { expr: "a.b(1, 2)[0].items", key: "" });
  assert.deepEqual(postfixAt("return this.s.if"), { expr: "this.s", key: "if" });
  assert.deepEqual(postfixAt("foo().not"), { expr: "foo()", key: "not" });
  assert.equal(postfixAt("1.5"), null, "number");
  assert.equal(postfixAt("  .if"), null, "nothing before the dot");
  assert.equal(postfixAt("a b"), null, "no dot");
  assert.equal(postfixAt("a..if"), null, "double dot");
});

test("fill puts the expression in and escapes snippet syntax", () => {
  const t = postfixes("cs").find((p) => p.key === "foreach")!.template;
  assert.equal(fill(t, "shapes"), "foreach (var ${item} in shapes)\n{\n\t${}\n}");
  assert.equal(fill("log($0)", "`${a}`"), "log(`$\\{a}`)");
  assert.ok(postfixes("ts").every((p) => p.template.includes("$0")));
});
