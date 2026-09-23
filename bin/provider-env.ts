#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Read the model credentials the caller passed. A provider the proxy can
// reach keeps its key here and the sandbox is given a placeholder instead.
import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
import {
  PLACEHOLDER,
  type Routes,
  TUNNELLED,
  UPSTREAM,
} from "../lib/inference.ts";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fail(message: string): never {
  console.error(`provider-env: ${message}`);
  process.exit(1);
}

function main(dest: string, routesFile: string) {
  const lines: string[] = [];
  const names: string[] = [];
  const routes: Routes = {};
  const tunnels: Routes = {};

  const blob = process.env.PROVIDER_ENV ?? "";
  blob.split("\n").forEach((raw, i) => {
    const line = raw.trim().replace(/^\uFEFF/, "");
    if (!line || line.startsWith("#")) {
      return;
    }

    const at = line.indexOf("=");
    if (at < 0) {
      fail(`line ${i + 1}: expected NAME=value`);
    }

    const name = line.slice(0, at).trim();
    if (!NAME.test(name)) {
      fail(`line ${i + 1}: "${name}" is not a variable name`);
    }

    const value = line.slice(at + 1).trim();
    if (!value) {
      fail(`line ${i + 1}: ${name} has no value`);
    }

    // GitHub masks the secret whole, which does not mask each line of it.
    console.log(`::add-mask::${value}`);
    const known = UPSTREAM[name];
    const tunnelled = TUNNELLED[name];
    if (known) {
      routes[known.provider] = { upstream: known.upstream, key: value };
    } else if (tunnelled) {
      tunnels[tunnelled] = { upstream: `https://${tunnelled}`, key: value };
    }
    lines.push(`${name}=${known || tunnelled ? PLACEHOLDER : value}\n`);
    names.push(name);
  });

  writeFileSync(dest, lines.join(""));
  chmodSync(dest, 0o600);
  writeFileSync(routesFile, JSON.stringify({ routes, tunnels }));
  chmodSync(routesFile, 0o600);

  const behind = Object.keys(routes);
  const through = Object.keys(tunnels);
  const direct = names.filter((name) => !UPSTREAM[name] && !TUNNELLED[name]);
  console.log(
    `held here, reached through the proxy: ${behind.join(", ") || "none"}`
  );
  console.log(
    `held here, reached through the tunnel: ${through.join(", ") || "none"}`
  );
  console.log(`given to the sandbox: ${direct.join(", ") || "none"}`);

  appendFileSync(
    process.env.GITHUB_ENV!,
    `PROVIDER_ENV_FILE=${dest}\n` +
      `PROVIDER_ENV_NAMES=${names.join(" ")}\n` +
      `MODEL_ROUTES=${routesFile}\n` +
      `MODEL_BEHIND_PROXY=${behind.join(" ")}\n` +
      `MODEL_TUNNEL_HOSTS=${through.join(" ")}\n`
  );
}

main(process.argv[2]!, process.argv[3]!);
