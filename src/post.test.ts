import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let api: Server;
let temp: string;
let sent: { path: string; body: string }[] = [];
let reject: Set<string>;
let publish: typeof import("./post.ts").publish;

before(async () => {
  api = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      sent.push({ path: req.url!, body });
      if ([...reject].some((r) => req.url!.includes(r))) {
        res.writeHead(422).end('{"message":"line must be part of the diff"}');
      } else {
        res.writeHead(201, { "content-type": "application/json" }).end('{"id":1}');
      }
    });
  });
  await new Promise<void>((done) => api.listen(0, "127.0.0.1", done));

  temp = mkdtempSync(join(tmpdir(), "post-"));
  process.env.RUNNER_TEMP = temp;
  process.env.GITHUB_REPOSITORY = "o/p";
  process.env.ISSUE_NUMBER = "7";
  process.env.GITHUB_API_URL = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  ({ publish } = await import(`./post.ts?${temp}`));
});

after(() => {
  api?.close();
  rmSync(temp, { recursive: true, force: true });
});

beforeEach(() => {
  sent = [];
  reject = new Set();
  writeFileSync(join(temp, "finish.json"), JSON.stringify({ reply: "the answer" }));
  writeFileSync(join(temp, "relay.pushed"), "abc123\n");
  process.env.IS_PULL_REQUEST = "yes";
});

test("a refused review still delivers the answer", async () => {
  writeFileSync(join(temp, "findings.jsonl"), '{"path":"a.rb","line":9000,"body":"a point"}\n');
  reject.add("/reviews");

  await publish();

  assert.equal(sent.length, 2);
  assert.match(sent[0]!.path, /\/pulls\/7\/reviews$/);
  assert.match(sent[1]!.path, /\/issues\/7\/comments$/);
  const fallback = JSON.parse(sent[1]!.body).body;
  assert.match(fallback, /the answer/, "the reply survives");
  assert.match(fallback, /a\.rb/, "so does the point it could not anchor");
});

test("line comments on an issue go in the reply, not to the reviews endpoint", async () => {
  process.env.IS_PULL_REQUEST = "no";
  writeFileSync(join(temp, "findings.jsonl"), '{"path":"a.rb","line":1,"body":"a point"}\n');

  await publish();

  assert.equal(sent.length, 1);
  assert.match(sent[0]!.path, /\/issues\/7\/comments$/);
});
