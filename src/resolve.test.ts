import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// An issue needs no GitHub call, so this much is testable without one.
function resolve(env: NodeJS.ProcessEnv) {
  const dir = mkdtempSync(join(tmpdir(), "resolve-"));
  const out = join(dir, "out");
  writeFileSync(out, "");
  const run = spawnSync(join(import.meta.dirname, "resolve.ts"), [], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: out, ...env },
  });
  const wrote = Object.fromEntries(
    readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => {
      const at = l.indexOf("=");
      return [l.slice(0, at), l.slice(at + 1)];
    }),
  );
  rmSync(dir, { recursive: true, force: true });
  return { ...run, wrote };
}

test("an issue reads the default branch and cannot push", () => {
  const { wrote } = resolve({
    IS_PULL_REQUEST: "no", DEFAULT_BRANCH: "main",
    GITHUB_REPOSITORY: "acme/thing", ISSUE_NUMBER: "7",
  });
  assert.equal(wrote.ref, "refs/heads/main");
  assert.equal(wrote.head_ref, "main");
  assert.equal(wrote.can_push, "false");
  assert.match(wrote.reason!, /not a pull request/);
});
