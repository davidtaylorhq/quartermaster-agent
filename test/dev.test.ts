import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function client(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "dev-client-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ssh = join(dir, "ssh");
  writeFileSync(
    ssh,
    `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
fs.writeFileSync(process.env.SSH_ARGS, JSON.stringify(process.argv.slice(2)));
const result = spawnSync("bash", [], { input: fs.readFileSync(0), encoding: "utf8" });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`
  );
  chmodSync(ssh, 0o755);
  const args = join(dir, "args.json");
  const run = (...command: string[]) =>
    spawnSync(join(import.meta.dirname, "../bin/dev"), command, {
      env: {
        ...process.env,
        HOME: dir,
        PATH: `${dir}:${process.env.PATH}`,
        SSH_ARGS: args,
      },
      encoding: "utf8",
    });
  return { dir, args, run };
}

test("dev preserves command arguments across the remote shell", (t) => {
  const { args, run } = client(t);
  const values = [
    "two words",
    "",
    "a'b",
    '"quoted"',
    "$(exit 19)",
    "`exit 20`",
    "one; exit 21",
    "two\nlines",
    "*.rb",
  ];
  const result = run(
    "rails",
    process.execPath,
    "-e",
    "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
    "--",
    ...values
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), values);
  assert.deepEqual(JSON.parse(readFileSync(args, "utf8")), [
    "-T",
    "workflow-gate",
    "dev rails",
  ]);
});

test("dev returns the remote command's failure", (t) => {
  const { run } = client(t);
  assert.equal(run("rails", "bash", "-c", "exit 23").status, 23);
});

test("dev requires an environment and a command", (t) => {
  const { args, run } = client(t);
  assert.equal(run("rails").status, 2);
  assert.throws(() => readFileSync(args), /ENOENT/);
});
