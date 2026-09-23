import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// With no repository to talk to it writes its state and says nothing, which is
// enough to pin that the first call carries the whole list.
function run(args: string[], state: string) {
  return spawnSync(join(import.meta.dirname, "progress.ts"), args, {
    encoding: "utf8",
    env: { ...process.env, PROGRESS_FILE: state, GITHUB_REPOSITORY: "", ASSET_REPO: "a/b", ASSET_REF: "c" },
  });
}

test("start records every step with the first under way", () => {
  const dir = mkdtempSync(join(tmpdir(), "progress-"));
  const state = join(dir, "progress.json");
  run(["start", "One", "Two", "Three"], state);
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), {
    labels: ["One", "Two", "Three"], at: 0,
  });
  run(["next"], state);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).at, 1);
  run(["done"], state);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).at, 3);
  rmSync(dir, { recursive: true, force: true });
});
