import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The reaction is the claim, so a run has to recognise its own.
const source = readFileSync(join(import.meta.dirname, "next-mention.ts"), "utf8");

test("the comment the workflow already reacted to is not treated as someone else's", () => {
  assert.match(source, /if \(String\(comment\.id\) === process\.env\.CLAIMED_ID\) return false;/);
  const ours = source.indexOf("CLAIMED_ID");
  const lookup = source.indexOf("comment.reactions?.eyes");
  assert.ok(ours < lookup, "ours must be checked before the reaction lookup");
});
