// The forwarder holds the credential, so what it refuses is what matters.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { handler } from "./git-forward.ts";

const REPO = "owner/project";
const AUTH = "Basic c2VjcmV0";

const READ = `/${REPO}.git/info/refs?service=git-upload-pack`;
const NEGOTIATE = `/${REPO}.git/git-upload-pack`;

let upstream: Server;
let forward: Server;
let asked: { url: string; authorization?: string; protocol?: string; body: string }[] = [];
let answer: (url: string) => { status: number; headers: Record<string, string>; body: string };

const at = (server: Server) => `http://127.0.0.1:${(server.address() as { port: number }).port}`;

before(async () => {
  upstream = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      asked.push({
        url: req.url!,
        authorization: req.headers.authorization,
        protocol: req.headers["git-protocol"] as string | undefined,
        body,
      });
      const { status, headers, body: out } = answer(req.url!);
      res.writeHead(status, headers).end(out);
    });
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));

  forward = createServer(handler(REPO, AUTH, at(upstream)));
  await new Promise<void>((done) => forward.listen(0, "127.0.0.1", done));
});

after(() => {
  upstream?.close();
  forward?.close();
});

function replies(status = 200, headers: Record<string, string> = {}, body = "") {
  asked = [];
  answer = () => ({ status, headers, body });
}

test("a push is refused at the first request git makes", async () => {
  replies();
  const refs = await fetch(`${at(forward)}/${REPO}.git/info/refs?service=git-receive-pack`);
  assert.equal(refs.status, 403);
  assert.equal(await refs.text(), "not permitted\n");

  const pack = await fetch(`${at(forward)}/${REPO}.git/git-receive-pack`, { method: "POST", body: "anything" });
  assert.equal(pack.status, 403);

  assert.deepEqual(asked, [], "nothing reached github");
});

test("another repository is refused", async () => {
  replies();
  for (const url of [
    "/someone/else.git/info/refs?service=git-upload-pack",
    "/someone/else.git/git-upload-pack",
    `/${REPO}.git/../../someone/else.git/git-upload-pack`,
  ]) {
    assert.equal((await fetch(at(forward) + url)).status, 403, url);
  }
  assert.deepEqual(asked, []);
});

test("a path that merely starts right is refused", async () => {
  replies();
  for (const url of [`${READ}&extra=1`, `${NEGOTIATE}/../git-receive-pack`, `/${REPO}.git/git-upload-pack?x=1`]) {
    assert.equal((await fetch(at(forward) + url)).status, 403, url);
  }
  assert.deepEqual(asked, []);
});

test("the advertisement is passed through with the credential added", async () => {
  replies(200, { "content-type": "application/x-git-upload-pack-advertisement" }, "001e# service=git-upload-pack\n");
  const response = await fetch(at(forward) + READ, { headers: { "git-protocol": "version=2" } });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-git-upload-pack-advertisement");
  assert.equal(await response.text(), "001e# service=git-upload-pack\n");
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.authorization, AUTH, "the sandbox never sends one, so the forwarder must");
  assert.equal(asked[0]!.protocol, "version=2", "protocol v2 must survive the hop");
});

test("the negotiation body reaches github and the pack comes back", async () => {
  replies(200, { "content-type": "application/x-git-upload-pack-result" }, "PACK-bytes");
  const response = await fetch(at(forward) + NEGOTIATE, {
    method: "POST",
    headers: { "content-type": "application/x-git-upload-pack-request" },
    body: "0032want 1111111111111111111111111111111111111111\n0000",
  });

  assert.equal(await response.text(), "PACK-bytes");
  assert.equal(asked[0]!.body, "0032want 1111111111111111111111111111111111111111\n0000");
  assert.equal(asked[0]!.authorization, AUTH);
});

test("a redirect is never followed, because the credential would follow it", async () => {
  replies(301, { location: "https://elsewhere.invalid/repo.git" });
  const response = await fetch(at(forward) + READ, { redirect: "manual" });

  assert.equal(response.status, 502);
  assert.equal(await response.text(), "upstream redirected\n");
  assert.equal(asked.length, 1, "one request went out, and its answer was dropped");
});

test("github being unreachable is reported, not hung on", async () => {
  const dead = createServer(handler(REPO, AUTH, "http://127.0.0.1:1"));
  await new Promise<void>((done) => dead.listen(0, "127.0.0.1", done));

  const response = await fetch(at(dead) + READ);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), "upstream unreachable\n");
  dead.close();
});

// A pack can be cut off part way. If that took the forwarder down, every
// later fetch in the run would fail with nothing to explain it.
test("an upstream that stops mid-response does not take the forwarder with it", async () => {
  const flaky = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/x-git-upload-pack-result" });
    res.write("PACK-par");
    setTimeout(() => res.socket?.destroy(), 20);
  });
  await new Promise<void>((done) => flaky.listen(0, "127.0.0.1", done));

  const front = createServer(handler(REPO, AUTH, at(flaky)));
  await new Promise<void>((done) => front.listen(0, "127.0.0.1", done));

  await assert.rejects(fetch(at(front) + READ).then((r) => r.text()));

  replies(200, { "content-type": "text/plain" }, "still here");
  const after = await fetch(at(forward) + READ);
  assert.equal(await after.text(), "still here");

  flaky.close();
  front.close();
});
