import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "workspace-shell-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (args: unknown) =>
    spawnSync(join(root, "bin/workspace-shell"), [], {
      input: JSON.stringify(args),
      encoding: "utf8",
      timeout: 10000,
    });
  return { dir, run };
}

test("shell interprets commands only in the requested sandbox directory", (t) => {
  const { dir, run } = fixture(t);
  const cwd = join(dir, "space ' quote\nnewline\n");
  mkdirSync(cwd);
  const command =
    "printf '%s' '$(exit 19) `exit 20` ; literal' > result\nprintf 'output\\n'\nprintf 'diagnostic\\n' >&2\nexit 23";
  const result = run({ command, working_dir: cwd });
  assert.equal(result.status, 23, result.stderr);
  assert.equal(result.stdout, "output\n");
  assert.equal(result.stderr, "diagnostic\n");
  assert.equal(
    readFileSync(join(cwd, "result"), "utf8"),
    "$(exit 19) `exit 20` ; literal"
  );
});

test("shell enforces its deadline inside the sandbox", (t) => {
  const { dir, run } = fixture(t);
  const result = run({
    command: "sleep 30",
    working_dir: dir,
    timeout_seconds: 1,
  });
  assert.equal(result.status, 124, result.stderr);
  assert.equal(
    result.error,
    undefined,
    "sandbox timeout must beat the test timeout"
  );
});

test("shell rejects malformed input before executing anything", (t) => {
  const { dir, run } = fixture(t);
  for (const args of [
    null,
    {},
    { command: 1 },
    { command: "echo unsafe\u0000" },
    ...[0, -1, 601, 1.5, "1"].map((timeout_seconds) => ({
      command: "echo unsafe",
      timeout_seconds,
    })),
    { command: "echo unsafe", working_dir: [dir] },
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, "");
  }
});

test("the trusted client forwards input unchanged and propagates SSH failure", (t) => {
  const { dir } = fixture(t);
  writeFileSync(
    join(dir, "ssh"),
    `#!/bin/bash
printf '%s\\n' "$@" > "$SSH_ARGS"
cat > "$SSH_INPUT"
exit 23
`,
    { mode: 0o755 }
  );
  const input = JSON.stringify({
    command: "touch should-not-exist; $(exit 19)",
    working_dir: "/src",
    timeout_seconds: 600,
  });
  const result = spawnSync(join(root, "agent/scripts/workspace-shell"), [], {
    cwd: dir,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      SSH_PORT: "2222",
      GATE_USER: "runner",
      SSH_ARGS: join(dir, "args"),
      SSH_INPUT: join(dir, "input"),
    },
  });
  assert.equal(result.status, 23, result.stderr);
  assert.equal(readFileSync(join(dir, "input"), "utf8"), input);
  assert.match(
    readFileSync(join(dir, "args"), "utf8"),
    /runner@host.docker.internal\nworkspace-shell\n$/
  );
  assert.throws(() => readFileSync(join(dir, "should-not-exist")), /ENOENT/);
});
