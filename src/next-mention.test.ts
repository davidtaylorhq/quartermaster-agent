import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Reacting is the claim, and only a 201 means this run made it.
const source = readFileSync(join(import.meta.dirname, "next-mention.ts"), "utf8");

test("a comment is claimed by the status of the reaction, not by reading them back", () => {
  assert.match(source, /return response\.status === 201;/);
  assert.doesNotMatch(source, /paginate/, "no second call to see who reacted");
  assert.doesNotMatch(source, /reactions\?\.eyes/, "no count to pre-filter on");
});
