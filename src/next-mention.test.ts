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
  const asking = source.indexOf("/reactions");
  assert.ok(ours !== -1 && ours < asking, "checked before asking GitHub again");
});

test("the claim keeps one identity even when the bot posts as another", () => {
  assert.match(source, /CLAIM_TOKEN/);
});
