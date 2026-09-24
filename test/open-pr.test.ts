import assert from "node:assert/strict";
import { test } from "node:test";
import { type BranchPolicy } from "../lib/branches.ts";
import { openPullRequest } from "../lib/open-pr.ts";

const policy: BranchPolicy = {
  head: "topic",
  defaultBranch: "main",
  canPushHead: true,
  patterns: ["backport/.*"],
  initial: {},
};
const input = {
  head: "backport/2026.5/123",
  base: "release/2026.5",
  title: "Backport fix",
  body: "Backport of #123",
};

test("PR creation resolves branches in the fixed repo and reuses existing PRs", async (t) => {
  const calls: { url: string; method: string; body?: string }[] = [];
  let existing = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      calls.push({
        url,
        method: options.method!,
        body: options.body as string,
      });
      const response = url.includes("/pulls?")
        ? existing
          ? [{ html_url: "https://github.com/o/r/pull/1" }]
          : []
        : { html_url: "https://github.com/o/r/pull/1" };
      return new Response(JSON.stringify(response));
    }
  );
  assert.deepEqual(await openPullRequest(policy, "o/r", input), {
    url: "https://github.com/o/r/pull/1",
    created: true,
  });
  assert.ok(
    calls[0]!.url.endsWith("/repos/o/r/branches/backport%2F2026.5%2F123")
  );
  assert.ok(calls[1]!.url.endsWith("/repos/o/r/branches/release%2F2026.5"));
  assert.deepEqual(JSON.parse(calls[3]!.body!), input);
  existing = true;
  calls.length = 0;
  assert.deepEqual(await openPullRequest(policy, "o/r", input), {
    url: "https://github.com/o/r/pull/1",
    created: false,
  });
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("unallowed heads and malformed requests make no API calls", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected API call");
  });
  for (const request of [
    null,
    {},
    { ...input, title: 3 },
    { ...input, head: "main" },
    { ...input, head: "other" },
    { ...input, base: input.head },
  ]) {
    await assert.rejects(openPullRequest(policy, "o/r", request));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("a missing head is not used to create a PR", async (t) => {
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("missing", { status: 404 })
  );
  await assert.rejects(openPullRequest(policy, "o/r", input), /404/);
  assert.equal(fetch.mock.callCount(), 1);
});
