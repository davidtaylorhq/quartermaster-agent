import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { handler, PLACEHOLDER, target } from "../lib/inference.ts";

const KEY = "sk-the-real-one";

let upstream: Server;
let proxy: Server;
let asked: { url: string; headers: Record<string, string>; body: string }[] =
  [];
let answer: () => { status: number; headers: Record<string, string> };

const at = (server: Server) =>
  `http://127.0.0.1:${(server.address() as { port: number }).port}`;

before(async () => {
  upstream = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      asked.push({
        url: req.url!,
        headers: req.headers as Record<string, string>,
        body,
      });
      const { status, headers } = answer();
      res.writeHead(status, headers).end("said");
    });
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));

  proxy = createServer(
    handler({ anthropic: { upstream: at(upstream), key: KEY } })
  );
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
});

after(() => {
  upstream?.close();
  proxy?.close();
});

function replies(status = 200, headers: Record<string, string> = {}) {
  asked = [];
  answer = () => ({ status, headers });
}

test("the slot names the model and the rest of the path is kept", () => {
  const routes = {
    anthropic: { upstream: "https://api.anthropic.com", key: KEY },
  };
  assert.equal(
    target(routes, "/anthropic/v1/messages?beta=1")?.to,
    "https://api.anthropic.com/v1/messages?beta=1"
  );
  assert.equal(target(routes, "/anthropic")?.to, "https://api.anthropic.com");
});

test("a slot with nothing behind it is refused", async () => {
  replies();
  for (const url of ["/openai/v1/chat", "/", "/anthropicc/v1"]) {
    assert.equal((await fetch(at(proxy) + url)).status, 403, url);
  }
  assert.deepEqual(asked, [], "nothing reached the provider");
});

test("the placeholder becomes the real key, wherever it is carried", async () => {
  replies();
  await fetch(`${at(proxy)}/anthropic/v1/messages?key=${PLACEHOLDER}`, {
    method: "POST",
    headers: {
      "x-api-key": PLACEHOLDER,
      authorization: `Bearer ${PLACEHOLDER}`,
      "anthropic-version": "2023-06-01",
    },
    body: '{"model":"claude"}',
  });

  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.headers["x-api-key"], KEY);
  assert.equal(asked[0]!.headers["authorization"], `Bearer ${KEY}`);
  assert.equal(asked[0]!.url, `/v1/messages?key=${KEY}`);
  assert.equal(
    asked[0]!.headers["anthropic-version"],
    "2023-06-01",
    "everything else survives the hop"
  );
  assert.equal(asked[0]!.body, '{"model":"claude"}');
});

test("a request carrying no placeholder gets no key", async () => {
  replies();
  await fetch(`${at(proxy)}/anthropic/v1/models`);
  assert.equal(asked[0]!.headers["x-api-key"], undefined);
});

test("a redirect is never followed, because the key would follow it", async () => {
  replies(301, { location: "https://elsewhere.invalid/v1" });
  const response = await fetch(`${at(proxy)}/anthropic/v1/messages`, {
    redirect: "manual",
  });
  assert.equal(response.status, 502);
  assert.equal(await response.text(), "upstream redirected\n");
});

test("the provider being unreachable is reported, not hung on", async () => {
  const dead = createServer(
    handler({ anthropic: { upstream: "http://127.0.0.1:1", key: KEY } })
  );
  await new Promise<void>((done) => dead.listen(0, "127.0.0.1", done));

  const response = await fetch(`${at(dead)}/anthropic/v1/messages`);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), "upstream unreachable\n");
  dead.close();
});
