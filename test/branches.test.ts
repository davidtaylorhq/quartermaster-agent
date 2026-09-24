import assert from "node:assert/strict";
import { test } from "node:test";
import { allowed, type BranchPolicy, patterns } from "../lib/branches.ts";

const rules: BranchPolicy = {
  head: "topic",
  defaultBranch: "main",
  canPushHead: true,
  patterns: patterns("backport/[0-9]+\\.[0-9]+/123\nrelease-fix"),
  initial: {},
};

test("patterns match whole branch names and invalid regexes fail", () => {
  assert.ok(allowed(rules, "topic"));
  assert.ok(allowed(rules, "backport/2026.5/123"));
  for (const branch of [
    "main",
    "backport/2026.5/123-extra",
    "prefix/release-fix",
    "backport/2026.5/456",
  ]) {
    assert.equal(allowed(rules, branch), false);
  }
  assert.throws(() => patterns("valid\n["), SyntaxError);
  assert.deepEqual(patterns("\n \n"), []);
});

test("extra patterns cannot override restrictions on the original or default branch", () => {
  const restricted = { ...rules, canPushHead: false, patterns: [".*"] };
  assert.equal(allowed(restricted, "topic"), false);
  assert.equal(allowed(restricted, "main"), false);
  assert.ok(allowed(restricted, "backport/2026.5/123"));
});
