import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "next-mention.ts"), "utf8");

test("a claim is settled by the reaction's status, not by reading reactions back", () => {
  assert.match(source, /return response\.status === 201;/);
  assert.doesNotMatch(source, /paginate/);
});

test("the mention the workflow already claimed is still ours", () => {
  const ours = source.indexOf("process.env.CLAIMED");
  const post = source.indexOf('request("POST"');
  assert.ok(ours !== -1 && ours < post, "checked before asking GitHub again");
});
