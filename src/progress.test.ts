import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// With no repository to talk to it writes its state and says nothing, which is
// enough to pin that the first call carries the whole list.
function run(args: string[], state: string, extra: Record<string, string> = {}) {
  return spawnSync(join(import.meta.dirname, "progress.ts"), args, {
    encoding: "utf8",
    env: {
      ...process.env,
      RUN_STARTED: "",
      ASKED: "",
      PROGRESS_FILE: state,
      GITHUB_REPOSITORY: "",
      ASSET_REPO: "a/b",
      ASSET_REF: "c",
      ...extra,
    },
  });
}

test("start records every step with the first under way", () => {
  const dir = mkdtempSync(join(tmpdir(), "progress-"));
  const state = join(dir, "progress.json");
  run(["start", "One", "Two", "Three"], state);
  const { labels, at } = JSON.parse(readFileSync(state, "utf8"));
  assert.deepEqual({ labels, at }, { labels: ["One", "Two", "Three"], at: 0 });
  run(["next"], state);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).at, 1);
  run(["done"], state);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).at, 3);
  rmSync(dir, { recursive: true, force: true });
});

// The checklist a run draws, walked the way a run walks it. Getting this wrong
// leaves a spinner against a step that finished.
test("a turn ends on the step that says it is waiting", () => {
  const dir = mkdtempSync(join(tmpdir(), "progress-"));
  const state = join(dir, "progress.json");
  const at = () => JSON.parse(readFileSync(state, "utf8")).at;
  const labels = () => JSON.parse(readFileSync(state, "utf8")).labels;

  run(["start", "Preparing the sandbox", "Working", "Replying", "Waiting 60s"], state);
  assert.equal(labels()[at()], "Preparing the sandbox");

  run(["next"], state);                      // the sandbox is up
  assert.equal(labels()[at()], "Working");
  run(["next"], state);                      // the agent has answered
  assert.equal(labels()[at()], "Replying");
  run(["next"], state);                      // the reply is posted
  assert.equal(labels()[at()], "Waiting 60s");

  // A follow-up adds its own three and starts on the first of them.
  run(["next", "Working", "Replying", "Waiting 60s"], state);
  assert.equal(labels()[at()], "Working");
  assert.equal(labels().length, 7);
  run(["next"], state);
  run(["next"], state);
  assert.equal(labels()[at()], "Waiting 60s");

  run(["done"], state);
  assert.equal(at(), labels().length, "nothing is left in progress");
  rmSync(dir, { recursive: true, force: true });
});

// The queue is over by the time anything here runs, so its length has to come
// from the two timestamps the run was given rather than from a clock.
test("the first step is timed from the comment to the workflow starting", () => {
  const dir = mkdtempSync(join(tmpdir(), "progress-"));
  const state = join(dir, "progress.json");
  const asked = "2026-09-23T14:25:00Z";

  run(["start", "Waiting for the workflow to start", "Preparing", "Working"], state, {
    ASKED: asked,
    RUN_STARTED: String(Date.parse(asked) + 9_000),
  });

  const saved = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(saved.at, 1, "the queue is already behind us");
  assert.equal(saved.took[0], 9_000);

  run(["next"], state);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).took.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("without both timestamps the first step is simply under way", () => {
  const dir = mkdtempSync(join(tmpdir(), "progress-"));
  const state = join(dir, "progress.json");
  run(["start", "Waiting for the workflow to start", "Preparing"], state, { ASKED: "not a date" });
  const saved = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(saved.at, 0);
  assert.deepEqual(saved.took, []);
  rmSync(dir, { recursive: true, force: true });
});
