#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Lets the sandbox clone the repository without holding a credential.
//
// Two paths reach GitHub and nothing else does. Both belong to `upload-pack`,
// which only ever reads, so this needs no understanding of what it carries.
// Writing stays with the ssh gate, where git itself decides what may reach the
// branch.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

// The hop's own, and a length that no longer describes a streamed body.
const OURS = ["host", "connection", "content-length", "transfer-encoding", "authorization"];

export function permitted(repo: string, method: string, url: string): boolean {
  if (method === "GET") return url === `/${repo}.git/info/refs?service=git-upload-pack`;
  if (method === "POST") return url === `/${repo}.git/git-upload-pack`;
  return false;
}

export function handler(repo: string, authorization: string, upstream = "https://github.com") {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const fail = (status: number, why: string) => {
      console.error(`${why}: ${req.method} ${req.url}`);
      res.writeHead(status, { "content-type": "text/plain" }).end(`${why}\n`);
    };
    if (!permitted(repo, req.method ?? "", req.url ?? "")) return fail(403, "not permitted");

    const headers: Record<string, string> = { authorization };
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string" && !OURS.includes(name)) headers[name] = value;
    }

    try {
      const answer = await fetch(upstream + req.url, {
        method: req.method,
        headers,
        body: req.method === "POST" ? (Readable.toWeb(req) as ReadableStream) : undefined,
        // Following one would carry the credential wherever it pointed.
        redirect: "manual",
        // @ts-expect-error node takes this to stream a request body
        duplex: "half",
      });
      if (answer.status >= 300 && answer.status < 400) return fail(502, "upstream redirected");

      res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") ?? "application/octet-stream" });
      answer.body ? Readable.fromWeb(answer.body as never).pipe(res) : res.end();
    } catch (error) {
      console.error(error);
      fail(502, "upstream unreachable");
    }
  };
}

if (import.meta.filename === process.argv[1]) {
  const [address, port] = [process.argv[2]!, Number(process.argv[3])];
  const auth = `Basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64")}`;
  createServer(handler(process.env.GITHUB_REPOSITORY!, auth, undefined)).listen(port, address, () =>
    console.error(`[forward] ${address}:${port} serves ${process.env.GITHUB_REPOSITORY} read-only`),
  );
}
