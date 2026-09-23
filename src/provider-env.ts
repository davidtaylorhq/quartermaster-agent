#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Read the model credentials the caller passed and leave them on the runner.
//
// Values are masked before anything can echo them. Nothing here puts them
// anywhere the sandbox can read on its own: the sandbox gets them because a
// provider needs them, and a shell of ours takes them back out again.
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
    const line = raw.trim().replace(/^﻿/, "");
    if (!line || line.startsWith("#")) return;

    const at = line.indexOf("=");
    if (at < 0) fail(`line ${i + 1}: expected NAME=value`);

    const name = line.slice(0, at).trim();
    if (!NAME.test(name)) fail(`line ${i + 1}: "${name}" is not a variable name`);

    const value = line.slice(at + 1).trim();
    if (!value) fail(`line ${i + 1}: ${name} has no value`);

    // Before the value reaches any log. GitHub masks the secret it was given
    // whole, which is not the same as masking each line of it.
    console.log(`::add-mask::${value}`);
    lines.push(`${name}=${value}\n`);
    names.push(name);
  });

  writeFileSync(dest, lines.join(""));
  chmodSync(dest, 0o600);
  console.log(`credentials held on the runner: ${names.join(", ") || "none"}`);

  appendFileSync(
    process.env.GITHUB_ENV!,
    `PROVIDER_ENV_FILE=${dest}\nPROVIDER_ENV_NAMES=${names.join(" ")}\n`,
  );
}

main(process.argv[2]!);
