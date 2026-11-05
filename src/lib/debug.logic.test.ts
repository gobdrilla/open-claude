import { test } from "node:test";
import assert from "node:assert/strict";
import { clip, frameName, pickFrame, toAbs, toRel } from "./debug.logic.ts";

test("toRel/toAbs between the debugger's paths and the repo", () => {
  assert.equal(toRel("/p/lab", "/p/lab/Lab/Program.cs"), "Lab/Program.cs");
  assert.equal(toRel("/p/lab/", "/P/Lab/Lab/Program.cs"), "Lab/Program.cs", "casing of the build");
  assert.equal(toRel("C:\\dev\\lab", "c:\\dev\\lab\\Lab\\Program.cs"), "Lab/Program.cs");
  assert.equal(toRel("/p/lab", "/p/labx/A.cs"), "/p/labx/A.cs", "sibling folder is outside");
  assert.equal(toAbs("/p/lab", "Lab/Program.cs"), "/p/lab/Lab/Program.cs");
  assert.equal(toAbs("C:\\dev\\lab\\", "Lab/Program.cs"), "C:\\dev\\lab\\Lab\\Program.cs");
});

test("pickFrame prefers the project's own code", () => {
  const f = (id: number, path: string | null) => ({ id, name: `f${id}`, path, line: 1 });
  assert.equal(pickFrame([f(1, null), f(2, "/usr/share/dotnet/x.cs"), f(3, "Lab/Program.cs")])?.id, 3);
  assert.equal(pickFrame([f(1, null), f(2, "C:/sdk/x.cs")])?.id, 2);
  assert.equal(pickFrame([f(1, null)])?.id, 1);
  assert.equal(pickFrame([]), undefined);
});

test("clip keeps whole lines at the end", () => {
  assert.equal(clip("abc", 10), "abc");
  assert.equal(clip("one\ntwo\nthree\n", 9), "three\n");
  assert.equal(clip("xxxxxxxx", 3), "xxx");
});

test("frameName drops the compiler's local function mangling", () => {
  assert.equal(frameName("Program.<<Main>$>g__Report|0_0(System.Collections.Generic.IEnumerable<Lab.IShape> all)"), "Program.Report(System.Collections.Generic.IEnumerable<Lab.IShape> all)");
  assert.equal(frameName("Lab.Shapes.<Grow>g__Inner|3_1()"), "Lab.Shapes.Inner()");
  assert.equal(frameName("Program.<Main>$()"), "Program.<Main>$()");
});
