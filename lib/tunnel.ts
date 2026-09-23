// Intercepts the TLS a provider speaks when term-llm reaches it by running a
// command. Nothing can point such a provider back here, so the sandbox trusts
// a certificate of ours and its connection is terminated on this side.
//
// The command still speaks for itself. All that moves is where the credential
// is held: the sandbox carries a placeholder and the real one is put back here.
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { refuse, relay, type Routes } from "./inference.ts";

export function intercept(
  hosts: Routes,
  material: { key: Buffer; cert: Buffer }
) {
  const asked = new WeakMap<object, string>();

  // This server owns the life of every socket handed to it. Closing one from
  // outside cuts the request it is still answering.
  const inner = createServer(async (req, res) => {
    const host = asked.get(req.socket);
    const route = host ? hosts[host] : undefined;
    if (!route) {
      return refuse(req, res, 403, "no model behind that host");
    }
    await relay(req, res, route.upstream + req.url, route.key);
  });

  return (req: IncomingMessage, client: Socket, head: Buffer) => {
    const [host, port] = (req.url ?? "").split(":");
    if (!host || !hosts[host] || port !== "443") {
      console.error(`not tunnelled: ${req.url}`);
      return client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }

    client.on("error", (error) => console.error(`${host}: ${error.message}`));
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) {
      client.unshift(head);
    }

    const secure = new TLSSocket(client, { isServer: true, ...material });
    secure.on("error", (error) => console.error(`${host}: ${error.message}`));
    asked.set(secure, host);
    inner.emit("connection", secure);
  };
}
