import { test } from "node:test";
import assert from "node:assert/strict";
import { usesFile } from "./gitcmds.logic.ts";

test("usesFile: $FILE und ${FILE}, nicht $FILES oder andere", () => {
  const f = (command: string) => usesFile({ name: "x", command });
  assert.equal(f('code "$FILE"'), true);
  assert.equal(f("cat ${FILE}"), true);
  assert.equal(f("cat $FILE;"), true);
  assert.equal(f("echo $FILES"), false);
  assert.equal(f("echo $FILE_X"), false);
  assert.equal(f("git log -1 $SHA"), false);
});
