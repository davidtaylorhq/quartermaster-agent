#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Turn the project's environments file into the JSON everything else reads.
//
// A fault here stops the run before the bot has claimed anybody's comment.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { load } from "../vendor/js-yaml.mjs";

const KNOWN = ["name", "description", "image", "entrypoint", "cmd", "user", "mount", "setup"] as const;
type Field = (typeof KNOWN)[number];

function fail(message: string): never {
  console.error(`environments: ${message}`);
  process.exit(1);
}

function main(source: string | undefined, dest: string) {
  if (!source || !existsSync(source)) {
    writeFileSync(dest, "{}");
    return;
  }

  const doc = load(readFileSync(source, "utf8")) as { environments?: unknown } | null;
  const list = doc?.environments;
  if (!Array.isArray(list)) fail("expected a list under `environments`");

  const out: Record<string, Record<Field, string>> = {};
  list.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail(`entry ${i + 1} is not a mapping`);
    }
    const env = entry as Record<string, unknown>;

    const name = String(env.name ?? "");
    if (!name) fail(`entry ${i + 1} has no name`);
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      fail(`"${name}" is not a name; use letters, digits, - and _`);
    }
    if (name in out) fail(`two environments are called "${name}"`);

    for (const field of ["image", "mount"] as const) {
      if (!String(env[field] ?? "")) fail(`${name} has no ${field}`);
    }
    for (const key of Object.keys(env)) {
      if (!KNOWN.includes(key as Field)) fail(`${name} has an unknown setting "${key}"`);
    }

    out[name] = Object.fromEntries(
      KNOWN.map((field) => [field, String(env[field] ?? "")]),
    ) as Record<Field, string>;
  });

  writeFileSync(dest, JSON.stringify(out, null, 2));
}

main(process.argv[2], process.argv[3]!);
