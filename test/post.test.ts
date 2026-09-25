import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

let api: Server;
let temp: string;
let sent: { path: string; body: string }[] = [];
let reject: Set<string>;
let rejectionStatus = 422;
let publish: typeof import("../lib/post.ts").publish;

before(async () => {
  api = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      sent.push({ path: req.url!, body });
      if ([...reject].some((r) => req.url!.includes(r))) {
        res
          .writeHead(rejectionStatus)
          .end('{"message":"line must be part of the diff"}');
      } else {
        res
          .writeHead(201, { "content-type": "application/json" })
          .end('{"id":1}');
      }
    });
  });
  await new Promise<void>((done) => api.listen(0, "127.0.0.1", done));

  temp = mkdtempSync(join(tmpdir(), "post-"));
  process.env.RUNNER_TEMP = temp;
  mkdirSync(join(temp, "output"));
  process.env.GITHUB_REPOSITORY = "o/p";
  process.env.ISSUE_NUMBER = "7";
  process.env.GITHUB_API_URL = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  ({ publish } = await import(`../lib/post.ts?${temp}`));
});

after(() => {
  api?.close();
  rmSync(temp, { recursive: true, force: true });
});

beforeEach(() => {
  sent = [];
  reject = new Set();
  rejectionStatus = 422;
  writeFileSync(
    join(temp, "output", "finish.json"),
    JSON.stringify({ reply: "the answer" })
  );
  writeFileSync(join(temp, "relay.pushed"), "abc123\n");
  process.env.IS_PULL_REQUEST = "yes";
  rmSync(join(temp, "output/findings.jsonl"), { force: true });
});

test("an inline request gets its answer in the original review thread", async () => {
  await publish(123);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.path, "/repos/o/p/pulls/7/comments/123/replies");
  assert.match(JSON.parse(sent[0]!.body).body, /the answer/);
});

test("a refused review still delivers the answer", async () => {
  writeFileSync(
    join(temp, "output", "findings.jsonl"),
    '{"path":"a.rb","line":9000,"body":"a point"}\n'
  );
  reject.add("/reviews");

  await publish();

  assert.equal(sent.length, 2);
  assert.match(sent[0]!.path, /\/pulls\/7\/reviews$/);
  assert.match(sent[1]!.path, /\/issues\/7\/comments$/);
  const fallback = JSON.parse(sent[1]!.body).body;
  assert.match(fallback, /the answer/, "the reply survives");
  assert.match(fallback, /a\.rb/, "so does the point it could not anchor");
  assert.equal(fallback.match(/help improve with/g)?.length, 1);
});

test("line comments on an issue go in the reply, not to the reviews endpoint", async () => {
  process.env.IS_PULL_REQUEST = "no";
  writeFileSync(
    join(temp, "output", "findings.jsonl"),
    '{"path":"a.rb","line":1,"body":"a point"}\n'
  );

  await publish();

  assert.equal(sent.length, 1);
  assert.match(sent[0]!.path, /\/issues\/7\/comments$/);
  const body = JSON.parse(sent[0]!.body).body;
  assert.match(body, /the answer/);
  assert.match(
    body,
    /a\.rb/,
    "the point is kept, not dropped for want of a diff"
  );
});

test("a findings line of null is skipped, not thrown over", async () => {
  writeFileSync(
    join(temp, "output", "findings.jsonl"),
    'null\n{"path":"a.rb","line":1,"body":"a point"}\n'
  );

  await publish();

  assert.equal(sent.length, 1);
  assert.match(sent[0]!.path, /\/pulls\/7\/reviews$/);
  assert.equal(JSON.parse(sent[0]!.body).comments.length, 1);
  assert.match(
    JSON.parse(sent[0]!.body).comments[0].body,
    /a point\n\n<sub>:robot: AI generated response - help improve with 👍 or 👎<\/sub>$/
  );
});

test("publication protects claims even when GitHub refuses the reply", async () => {
  const { remember } = await import("../lib/claims.ts");
  const { existsSync } = await import("node:fs");
  remember(100, 101);
  reject.add("/comments");
  reject.add("/reviews");
  await assert.rejects(publish());
  assert.equal(existsSync(join(temp, "pending-claims")), false);
});

test("missing agent output leaves claims eligible for retry", async () => {
  const { remember } = await import("../lib/claims.ts");
  const { existsSync } = await import("node:fs");
  remember(200, 201);
  rmSync(join(temp, "output/finish.json"));
  await assert.rejects(publish(), /nothing to post/);
  assert.equal(existsSync(join(temp, "pending-claims/issues-200")), true);
});

test("an uncertain review failure does not risk posting a duplicate reply", async () => {
  writeFileSync(
    join(temp, "output/findings.jsonl"),
    '{"path":"a.rb","line":1,"body":"point"}\n'
  );
  reject.add("/reviews");
  rejectionStatus = 503;
  await assert.rejects(publish(), /503/);
  assert.equal(sent.length, 1);
});
