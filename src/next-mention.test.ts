import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TRIGGER = 100;
let api: Server;
let comments: unknown[] = [];
let reacted: number[] = [];
let claim: typeof import("./next-mention.ts").claim;
let temp: string;

before(async () => {
  api = createServer((req, res) => {
    const posted = req.url!.match(/\/comments\/(\d+)\/reactions$/);
    if (req.method === "POST" && posted) {
      const id = Number(posted[1]);
      const first = !reacted.includes(id);
      reacted.push(id);
      // GitHub adds the reaction once; after that it says it is already there.
      res.writeHead(first ? 201 : 200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(comments));
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
  ({ claim } = await import(`./next-mention.ts?${temp}`));
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

const taken = () => (JSON.parse(readFileSync(join(temp, "mention.json"), "utf8")) as { id: number }[]).map((m) => m.id);

beforeEach(() => {
  // The workflow's first step reacted to the triggering comment already.
  reacted = [TRIGGER];
  comments = [comment(TRIGGER)];
});

test("the opening turn answers the comment the workflow already reacted to", async () => {
  assert.equal(await claim(false), true);
  assert.deepEqual(taken(), [TRIGGER], "the run's own reaction is not mistaken for someone else's");
  assert.deepEqual(reacted, [TRIGGER], "and it does not ask GitHub about it again");
});

// The workflow's reaction is good for one claim. A follow-up that kept
// believing it would answer the opening comment over and over.
test("a follow-up does not answer the opening comment again", async () => {
  await claim(false);
  assert.equal(await claim(true), false, "nothing new to say");
  assert.equal(await claim(true), false);
  assert.ok(reacted.length > 1, "it asked GitHub, and GitHub said it was taken");
});

test("a follow-up answers a genuinely new mention", async () => {
  await claim(false);
  comments = [comment(TRIGGER), comment(200)];
  assert.equal(await claim(true), true);
  assert.deepEqual(taken(), [200]);
});
