#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Serves the sandbox's model requests, holding the credential it must not.
// What is reachable and how the key is put back is in `lib/inference.ts`.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { handler, type Routes } from "../lib/inference.ts";

const [address, port, file] = [
  process.argv[2]!,
  Number(process.argv[3]),
  process.argv[4]!,
];
const routes = JSON.parse(readFileSync(file, "utf8")) as Routes;

createServer(handler(routes)).listen(port, address, () =>
  console.error(
    `[model] ${address}:${port} serves ${Object.keys(routes).join(", ") || "nothing"}`
  )
);
