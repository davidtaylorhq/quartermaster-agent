// Lets the sandbox clone without holding a credential.
//
// Both paths it allows belong to `upload-pack`, which only reads, so checking
// the path is the whole policy. Pushes go to the ssh gate instead.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Set here: the body is streamed, so its length changes, and this is a new hop.
const OURS = [
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "authorization",
];

export function permitted(repo: string, method: string, url: string): boolean {
  if (method === "GET") {
    return url === `/${repo}.git/info/refs?service=git-upload-pack`;
  }
  if (method === "POST") {
    return url === `/${repo}.git/git-upload-pack`;
  }
  return false;
}

export function handler(
  repo: string,
  authorization: string,
  upstream = "https://github.com"
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const fail = (status: number, why: string) => {
      console.error(`${why}: ${req.method} ${req.url}`);
      // Past the headers there is no status left to send, only a broken pipe.
      if (res.headersSent) {
        res.destroy();
      } else {
        res.writeHead(status, { "content-type": "text/plain" }).end(`${why}\n`);
      }
    };
    if (!permitted(repo, req.method ?? "", req.url ?? "")) {
      return fail(403, "not permitted");
    }

    const headers: Record<string, string> = { authorization };
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string" && !OURS.includes(name)) {
        headers[name] = value;
      }
    }

    try {
      const answer = await fetch(upstream + req.url, {
        method: req.method,
        headers,
        body:
          req.method === "POST"
            ? (Readable.toWeb(req) as ReadableStream)
            : undefined,
        // A redirect would carry the credential wherever it pointed.
        redirect: "manual",
        // @ts-expect-error node takes this to stream a request body
        duplex: "half",
      });
      if (answer.status >= 300 && answer.status < 400) {
        return fail(502, "upstream redirected");
      }

      res.writeHead(answer.status, {
        "content-type":
          answer.headers.get("content-type") ?? "application/octet-stream",
      });
      if (!answer.body) {
        return res.end();
      }
      await pipeline(Readable.fromWeb(answer.body as never), res);
    } catch (error) {
      console.error(error);
      fail(502, "upstream unreachable");
    }
  };
}
