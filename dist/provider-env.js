#!/usr/bin/env node

// src/provider-env.ts
import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
var NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function fail(message) {
  console.error(`provider-env: ${message}`);
  process.exit(1);
}
function main(dest) {
  const lines = [];
  const names = [];
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
    console.log(`::add-mask::${value}`);
    lines.push(`${name}=${value}
`);
    names.push(name);
  });
  writeFileSync(dest, lines.join(""));
  chmodSync(dest, 384);
  console.log(`credentials held on the runner: ${names.join(", ") || "none"}`);
  appendFileSync(
    process.env.GITHUB_ENV,
    `PROVIDER_ENV_FILE=${dest}
PROVIDER_ENV_NAMES=${names.join(" ")}
`
  );
}
main(process.argv[2]);
