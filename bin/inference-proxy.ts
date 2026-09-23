#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Serves the sandbox's model requests, holding the credential it must not.
// What is reachable and how the key is put back is in `lib/inference.ts`.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { handler, type Routes } from "../lib/inference.ts";
import { intercept } from "../lib/tunnel.ts";

const [address, port, file] = [
  process.argv[2]!,
  Number(process.argv[3]),
  process.argv[4]!,
];
const [keyFile, certFile] = [process.argv[5], process.argv[6]];

const { routes, tunnels } = JSON.parse(readFileSync(file, "utf8")) as {
  routes: Routes;
  tunnels: Routes;
};

const server = createServer(handler(routes));
const hosts = Object.keys(tunnels);
if (hosts.length) {
  server.on(
    "connect",
    intercept(tunnels, {
      key: readFileSync(keyFile!),
      cert: readFileSync(certFile!),
    })
  );
}

server.listen(port, address, () => {
  console.error(
    `[model] ${address}:${port} serves ${Object.keys(routes).join(", ") || "nothing"}`
  );
  if (hosts.length) {
    console.error(`[model] tunnels ${hosts.join(", ")}`);
  }
});
