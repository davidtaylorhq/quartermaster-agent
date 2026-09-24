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

for (const failure of ["none", "setup", "user", "run"]) {
  test(`development environment recovery after ${failure} failure`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "dev-boot-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, ".workflow-agent"));
    writeFileSync(
      join(dir, "environments.json"),
      JSON.stringify({
        test: { image: "test", mount: "/src", user: "dev", setup: "prepare" },
      })
    );
    writeFileSync(
      join(dir, ".workflow-agent/env"),
      [
        `export RUNNER_TEMP=${dir}`,
        `export WORKTREE=${dir}`,
        `export ENVIRONMENTS=${dir}/environments.json`,
        `export PROGRESS=${dir}/progress`,
        "export BOT_NAME=test",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(dir, "progress"),
      '#!/bin/sh\necho "$*" >> "$RUNNER_TEMP/progress.log"\n',
      { mode: 0o755 }
    );
    writeFileSync(
      join(dir, "docker"),
      `#!/bin/bash
set -eu
echo "$*" >> "$RUNNER_TEMP/docker.log"
case "$1" in
inspect) [ -f "$RUNNER_TEMP/running" ] || exit 1; echo running ;;
run) [ "$FAILURE" != run ] || exit 1; touch "$RUNNER_TEMP/running" ;;
exec)
  if [ "$3" = root ]; then [ "$FAILURE" != user ]; else [ "$FAILURE" != setup ]; fi ;;
esac
`,
      { mode: 0o755 }
    );
    const run = () =>
      spawnSync(
        "bash",
        [join(import.meta.dirname, "../bin/dev-boot"), "test"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: dir,
            PATH: `${dir}:${process.env.PATH}`,
            FAILURE: failure,
          },
        }
      );
    assert.equal(run().status, failure === "none" ? 0 : 1);
    assert.equal(
      readFileSync(join(dir, "progress.log"), "utf8"),
      "interrupt Preparing test\nresume\n"
    );
    const second = run();
    assert.equal(
      second.status,
      ["none", "setup"].includes(failure) ? 0 : 1,
      second.stderr
    );
    const calls = readFileSync(join(dir, "docker.log"), "utf8").split("\n");
    assert.equal(
      calls.filter(
        (line) => line.startsWith("exec") && line.includes("prepare")
      ).length,
      ["none", "setup"].includes(failure) ? 1 : 0
    );
    if (failure === "user") {
      assert.match(second.stderr, /did not establish a usable/);
    }
  });
}
