import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { request as secureRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { connect, type TLSSocket } from "node:tls";
import { PLACEHOLDER } from "../lib/inference.ts";
import { intercept } from "../lib/tunnel.ts";

const HOST = "api.anthropic.com";
const KEY = "oat-the-real-one";

let dir: string;
let ca: Buffer;
let upstream: Server;
let proxy: Server;
let asked: { url: string; authorization?: string; body: string }[] = [];

function openssl(...args: string[]) {
  const run = spawnSync("openssl", args, { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tunnel-"));
  const at = (name: string) => join(dir, name);
  writeFileSync(
    at("ext"),
    `subjectAltName=DNS:${HOST}\nbasicConstraints=CA:FALSE\n`
  );
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=test-ca",
    "-keyout",
    at("ca.key"),
    "-out",
    at("ca.crt")
  );
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=model",
    "-keyout",
    at("model.key"),
    "-out",
    at("model.csr")
  );
  openssl(
    "x509",
    "-req",
    "-in",
    at("model.csr"),
    "-days",
    "1",
    "-CA",
    at("ca.crt"),
    "-CAkey",
    at("ca.key"),
    "-CAcreateserial",
    "-out",
    at("model.crt"),
    "-extfile",
    at("ext")
  );
  ca = readFileSync(at("ca.crt"));

  upstream = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      asked.push({
        url: req.url!,
        authorization: req.headers.authorization,
        body,
      });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));

  proxy = createServer((_req, res) => res.writeHead(404).end());
  proxy.on(
    "connect",
    intercept(
      {
        [HOST]: {
          upstream: `http://127.0.0.1:${port(upstream)}`,
          key: KEY,
        },
      },
      {
        key: readFileSync(at("model.key")),
        cert: readFileSync(at("model.crt")),
      }
    )
  );
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
});

after(() => {
  upstream?.close();
  proxy?.close();
  rmSync(dir, { recursive: true, force: true });
});

const port = (server: Server) => (server.address() as { port: number }).port;

// Everything the CLI does: CONNECT, then speak TLS to what answers.
function tunnelled(target: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tunnel = request({
      host: "127.0.0.1",
      port: port(proxy),
      method: "CONNECT",
      path: target,
    });
    tunnel.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`CONNECT answered ${res.statusCode}`));
      }
      const secure = connect({ socket, servername: HOST, ca }, () =>
        resolve(secure)
      );
      secure.on("error", reject);
    });
    tunnel.on("error", reject);
    tunnel.end();
  });
}

test("a host with nothing behind it is never tunnelled", async () => {
  await assert.rejects(tunnelled("api.openai.com:443"));
  await assert.rejects(tunnelled(`${HOST}:8080`));
});

test("the certificate is trusted, and the placeholder becomes the real key", async () => {
  asked = [];
  const secure = await tunnelled(`${HOST}:443`);

  const answer = await new Promise<string>((resolve, reject) => {
    const call = secureRequest(
      {
        host: HOST,
        path: "/v1/messages",
        method: "POST",
        createConnection: () => secure,
        headers: {
          authorization: `Bearer ${PLACEHOLDER}`,
          "content-type": "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      }
    );
    call.on("error", reject);
    call.end('{"model":"claude"}');
  });

  assert.equal(answer, "{}");
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.url, "/v1/messages");
  assert.equal(asked[0]!.authorization, `Bearer ${KEY}`);
  assert.equal(asked[0]!.body, '{"model":"claude"}');
});
