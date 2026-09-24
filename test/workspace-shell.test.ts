import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "workspace-shell-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "ssh"),
    `#!/bin/bash
printf '%s\\n' "$@" > "$SSH_ARGS"
cat > "$SSH_INPUT"
exit 23
`,
    { mode: 0o755 }
  );
  const run = (...args: string[]) =>
    spawnSync(
      join(import.meta.dirname, "../agent/scripts/workspace-shell"),
      args,
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          SSH_ARGS: join(dir, "args"),
          SSH_INPUT: join(dir, "input"),
        },
      }
    );
  return { dir, run };
}

test("the shell client forwards the command literally and propagates SSH failure", (t) => {
  const { dir, run } = fixture(t);
  const command =
    "touch should-not-exist; $(exit 19)\ncd 'directory with spaces' && printf '%s' `exit 20`\n";
  const result = run(command);
  assert.equal(result.status, 23, result.stderr);
  assert.equal(readFileSync(join(dir, "input"), "utf8"), command + "\n");
  assert.equal(
    readFileSync(join(dir, "args"), "utf8"),
    "-T\nworkflow-gate\nworkspace-shell\n"
  );
  assert.throws(() => readFileSync(join(dir, "should-not-exist")), /ENOENT/);
});

test("a missing command fails before contacting the gate", (t) => {
  const { dir, run } = fixture(t);
  assert.equal(run().status, 1);
  assert.throws(() => readFileSync(join(dir, "args")), /ENOENT/);
});
