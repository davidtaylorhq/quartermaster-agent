// Lets the sandbox reach a model without holding the credential.
//
// The sandbox is given a placeholder in place of the key. Wherever that
// placeholder arrives here it is swapped for the real one, so this side needs
// to know nothing about how a provider carries its credential.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type Routes = Record<string, { upstream: string; key: string }>;

export const PLACEHOLDER = "workflow-agent-holds-this-key";

// Set here: the body is streamed, so its length changes, and this is a new hop.
const OURS = ["host", "connection", "content-length", "transfer-encoding"];

export function target(
  routes: Routes,
  url: string
): { to: string; key: string } | null {
  const slash = url.indexOf("/", 1);
  const slot = url.slice(1, slash < 0 ? undefined : slash);
  const route = routes[slot];
  if (!url.startsWith("/") || !route) {
    return null;
  }
  const rest = slash < 0 ? "" : url.slice(slash);
  return {
    to:
      route.upstream.replace(/\/$/, "") +
      rest.split(PLACEHOLDER).join(route.key),
    key: route.key,
  };
}

export function refuse(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  why: string
) {
  console.error(`${why}: ${req.method} ${req.url}`);
  // Past the headers there is no status left to send, only a broken pipe.
  if (res.headersSent) {
    res.destroy();
  } else {
    res.writeHead(status, { "content-type": "text/plain" }).end(`${why}\n`);
  }
}

export async function relay(
  req: IncomingMessage,
  res: ServerResponse,
  to: string,
  key: string
) {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && !OURS.includes(name)) {
      headers[name] = value.split(PLACEHOLDER).join(key);
    }
  }

  const sends = req.method !== "GET" && req.method !== "HEAD";
  try {
    const answer = await fetch(to, {
      method: req.method,
      headers,
      body: sends ? (Readable.toWeb(req) as ReadableStream) : undefined,
      // A redirect would carry the credential wherever it pointed.
      redirect: "manual",
      // @ts-expect-error node takes this to stream a request body
      duplex: "half",
    });
    if (answer.status >= 300 && answer.status < 400) {
      return refuse(req, res, 502, "upstream redirected");
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
    refuse(req, res, 502, "upstream unreachable");
  }
}

export function handler(routes: Routes) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const found = target(routes, req.url ?? "");
    if (!found) {
      return refuse(req, res, 403, "no model behind that path");
    }
    await relay(req, res, found.to, found.key);
  };
}

// term-llm only honours `base_url` for some of its providers, and a model can
// only be reached through a path here if it does. A provider it runs as a
// command is reached through the tunnel instead.
export const UPSTREAM: Record<string, { provider: string; upstream: string }> =
  {
    ANTHROPIC_API_KEY: {
      provider: "anthropic",
      upstream: "https://api.anthropic.com",
    },
  };

// A credential carried by a command term-llm runs, which no configuration can
// redirect. The host it talks to is intercepted instead.
export const TUNNELLED: Record<string, string> = {
  CLAUDE_CODE_OAUTH_TOKEN: "api.anthropic.com",
};
