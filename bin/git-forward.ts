#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Serves the sandbox's reads of this repository, holding the credential it
// must not. What it will and will not forward is in `lib/forward.ts`.
import { createServer } from "node:http";
import { handler } from "../lib/forward.ts";

const [address, port] = [process.argv[2]!, Number(process.argv[3])];
const repo = process.env.GITHUB_REPOSITORY!;
const auth = `Basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64")}`;

createServer(handler(repo, auth)).listen(port, address, () =>
  console.error(`[forward] ${address}:${port} serves ${repo} read-only`)
);
