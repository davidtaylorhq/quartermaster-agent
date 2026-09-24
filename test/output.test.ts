import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readOutput } from "../lib/output.ts";

test("output reads accept regular files but never follow links into the runner", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "output-"));
  const previous = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = dir;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.RUNNER_TEMP;
    } else {
      process.env.RUNNER_TEMP = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(dir, "output"));
  assert.equal(readOutput("finish.json"), undefined);
  writeFileSync(join(dir, "output/finish.json"), '{"reply":"done"}');
  assert.equal(readOutput("finish.json"), '{"reply":"done"}');
  writeFileSync(join(dir, "private"), "runner secret");
  symlinkSync(join(dir, "private"), join(dir, "output/findings.jsonl"));
  assert.throws(() => readOutput("findings.jsonl"), /ELOOP/);
  rmSync(join(dir, "output/findings.jsonl"));
  execFileSync("mkfifo", [join(dir, "output/findings.jsonl")]);
  assert.throws(() => readOutput("findings.jsonl"), /must be a regular file/);
});
