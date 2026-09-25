import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

const TRIGGER = 100;
let api: Server;
let comments: unknown[] = [];
let reviewComments: ReturnType<typeof reviewComment>[] = [];
let reviewReacted: number[] = [];
let reacted: number[] = [];
let claim: typeof import("../lib/claim.ts").claim;
let temp: string;

before(async () => {
  api = createServer((req, res) => {
    const posted = req.url!.match(/\/comments\/(\d+)\/reactions$/);
    if (req.method === "POST" && posted) {
      const id = Number(posted[1]);
      const reactions = req.url!.includes("/pulls/") ? reviewReacted : reacted;
      const first = !reactions.includes(id);
      reactions.push(id);
      // GitHub adds the reaction once; after that it says it is already there.
      res
        .writeHead(first ? 201 : 200, { "content-type": "application/json" })
        .end(JSON.stringify({ id: id + 1000 }));
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify(req.url!.includes("/pulls/") ? reviewComments : comments)
      );
  });
  await new Promise<void>((done) => api.listen(0, "127.0.0.1", done));

  temp = mkdtempSync(join(tmpdir(), "claim-"));
  Object.assign(process.env, {
    RUNNER_TEMP: temp,
    GITHUB_API_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`,
    GITHUB_REPOSITORY: "o/p",
    ISSUE_NUMBER: "7",
    MENTION: "@bot",
    TRUSTED_ASSOCIATIONS: "OWNER",
    MAX_COMMENT_AGE_HOURS: "1",
    FOLLOWUP_WINDOW: "0",
    CLAIMED: String(TRIGGER),
  });
  ({ claim } = await import(`../lib/claim.ts?${temp}`));
});

after(() => {
  api?.close();
  rmSync(temp, { recursive: true, force: true });
});

function comment(id: number) {
  return {
    id,
    body: "@bot please",
    created_at: new Date().toISOString(),
    author_association: "OWNER",
    user: { login: "someone" },
  };
}

function reviewComment(id: number, parent?: number) {
  return {
    ...comment(id),
    in_reply_to_id: parent,
    path: "app/example.js",
    line: 12,
    diff_hunk: "@@ -11 +11 @@\n+broken()",
    html_url: `https://github.com/o/p/pull/7#discussion_r${id}`,
  };
}

beforeEach(() => {
  // The workflow's first step reacted to the triggering comment already.
  reacted = [TRIGGER];
  comments = [comment(TRIGGER)];
  reviewComments = [];
  reviewReacted = [];
  process.env.IS_PULL_REQUEST = "no";
  process.env.COMMENT_KIND = "issues";
});

test("the opening turn answers the comment the workflow already reacted to", async () => {
  assert.deepEqual(
    (await claim(false)).map((m) => m.id),
    [TRIGGER],
    "the run's own reaction is not mistaken for someone else's"
  );
  assert.deepEqual(
    reacted,
    [TRIGGER],
    "and it does not ask GitHub about it again"
  );
});

// The workflow's reaction is good for one claim. A follow-up that kept
// believing it would answer the opening comment over and over.
test("a follow-up does not answer the opening comment again", async () => {
  await claim(false);
  assert.deepEqual(await claim(true), [], "nothing new to say");
  assert.deepEqual(await claim(true), []);
  assert.ok(
    reacted.length > 1,
    "it asked GitHub, and GitHub said it was taken"
  );
});

test("a follow-up answers a genuinely new mention", async () => {
  await claim(false);
  comments = [comment(TRIGGER), comment(200)];
  assert.deepEqual(
    (await claim(true)).map((m) => m.id),
    [200]
  );
});

test("a newly acquired reaction is recorded for safe failure recovery", async () => {
  comments = [comment(300)];
  await claim(true);
  const { readFileSync } = await import("node:fs");
  assert.deepEqual(
    JSON.parse(readFileSync(join(temp, "pending-claims/issues-300"), "utf8")),
    { comment: 300, reaction: 1300, kind: "issues" }
  );
});

test("the triggering comment remains eligible after the backlog age limit", async () => {
  comments = [{ ...comment(TRIGGER), created_at: "2020-01-01T00:00:00Z" }];
  assert.deepEqual(
    (await claim(false)).map((m) => m.id),
    [TRIGGER]
  );
});

test("mentions from unauthorized users and bots remain ineligible", async () => {
  comments = [
    { ...comment(TRIGGER), author_association: "NONE" },
    { ...comment(200), user: { login: "patch-triage[bot]" } },
    { ...comment(300), body: "no mention here" },
  ];
  assert.deepEqual(await claim(false), []);
});

test("an inline trigger includes its older finding and preserves claim namespaces", async () => {
  process.env.IS_PULL_REQUEST = "yes";
  process.env.COMMENT_KIND = "pulls";
  reviewReacted = [TRIGGER];
  reviewComments = [
    {
      ...reviewComment(90),
      body: "The plugin report name is misspelled",
      created_at: "2020-01-01T00:00:00Z",
      author_association: "NONE",
    },
    { ...reviewComment(TRIGGER, 90), body: "@bot fix this one" },
  ];
  const asked = await claim(false);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.replyTo, 90);
  assert.match(asked[0]!.context!, /plugin report name is misspelled/);
  assert.match(asked[0]!.context!, /app\/example.js, line 12/);
  assert.match(asked[0]!.context!, /broken\(\)/);
  assert.deepEqual(
    await claim(true),
    [],
    "the same inline request is not answered twice"
  );
});

test("a running PR session discovers inline follow-ups and rejects untrusted ones", async () => {
  process.env.IS_PULL_REQUEST = "yes";
  await claim(false);
  reviewComments = [
    { ...reviewComment(90), body: "A finding" },
    reviewComment(200, 90),
    { ...reviewComment(201, 90), author_association: "NONE" },
    { ...reviewComment(202, 90), user: { login: "other[bot]" } },
  ];
  assert.deepEqual(
    (await claim(true)).map((m) => m.id),
    [200]
  );
  assert.deepEqual(reviewReacted, [200]);
  const { readFileSync } = await import("node:fs");
  assert.deepEqual(
    JSON.parse(readFileSync(join(temp, "pending-claims/pulls-200"), "utf8")),
    {
      comment: 200,
      reaction: 1200,
      kind: "pulls",
    }
  );
});

test("a mention on a new inline thread uses that comment as the reply target", async () => {
  process.env.IS_PULL_REQUEST = "yes";
  reviewComments = [reviewComment(300)];
  const asked = await claim(true);
  assert.equal(asked[0]!.replyTo, 300);
  assert.equal(asked[0]!.body, "@bot please");
});
