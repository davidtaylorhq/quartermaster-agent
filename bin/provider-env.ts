#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
import { appendFileSync, chmodSync, writeFileSync } from "node:fs";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fail(message: string): never {
  console.error(`provider-env: ${message}`);
  process.exit(1);
}

function main(dest: string) {
  const lines: string[] = [];
  const names: string[] = [];

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
    lines.push(`${name}=${value}\n`);
    names.push(name);
  });

  writeFileSync(dest, lines.join(""));
  chmodSync(dest, 0o600);
  console.log(`given to the agent container: ${names.join(", ") || "none"}`);

  appendFileSync(
    process.env.GITHUB_ENV!,
    `PROVIDER_ENV_FILE=${dest}\n` + `PROVIDER_ENV_NAMES=${names.join(" ")}\n`
  );
}

main(process.argv[2]!);
