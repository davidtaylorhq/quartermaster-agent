import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type Row = {
  id: string;
  label: string;
  started: number | null;
  finished: number | null;
};

// With no repository to talk to it writes its state and says nothing.
function board(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "progress-"));
  const state = join(dir, "progress.json");
  const run = (...args: string[]) =>
    spawnSync(join(import.meta.dirname, "..", "bin", "progress.ts"), args, {
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
  const rows = (): Row[] =>
    (JSON.parse(readFileSync(state, "utf8")) as { rows: Row[] }).rows;
  const state_of = (id: string) => {
    const r = rows().find((x) => x.id === id)!;
    return r.finished !== null
      ? "done"
      : r.started !== null
        ? "running"
        : "pending";
  };
  return {
    run,
    rows,
    state_of,
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("start lays out the line with the first step under way", () => {
  const b = board();
  b.run("start", "One", "Two", "Three");
  assert.deepEqual(
    b.rows().map((r) => r.label),
    ["One", "Two", "Three"]
  );
  assert.equal(b.state_of("0"), "running");
  assert.equal(b.state_of("1"), "pending");
  b.done();
});

test("a turn ends on the step that says it is waiting", () => {
  // As a run has it: the queue is already timed and behind us.
  const asked = "2026-09-23T14:25:00Z";
  const b = board({
    ASKED: asked,
    RUN_STARTED: String(Date.parse(asked) + 1_000),
  });
  b.run(
    "start",
    "Waiting for GitHub",
    "Preparing the sandbox",
    "Working",
    "Replying",
    "Waiting 60s"
  );
  b.run("next"); // the sandbox is up
  assert.equal(b.rows()[2]!.label, "Working");
  assert.equal(b.state_of("2"), "running");
  b.run("next"); // the agent has answered
  b.run("next"); // the reply is posted
  assert.equal(b.rows()[4]!.label, "Waiting 60s");
  assert.equal(b.state_of("4"), "running");

  b.run("next", "Working", "Replying", "Waiting 60s");
  assert.equal(b.state_of("4"), "done");
  assert.equal(b.state_of("5"), "running");

  b.run("done");
  assert.ok(b.rows().every((r) => r.finished !== null));
  b.done();
});

// Preparing an environment is not beside the turn, it stops it. A reader sees
// one thing happening, and the turn picks up again afterwards.
test("an environment stops the step it interrupts and hands it back", () => {
  const b = board();
  b.run("start", "Waiting", "Preparing", "Working", "Replying");
  b.run("next");
  b.run("next");
  assert.equal(b.state_of("2"), "running");

  b.run("interrupt", "Preparing rails");
  assert.equal(b.state_of("2"), "done", "the turn stopped for it");
  assert.deepEqual(
    b.rows().map((r) => r.label),
    ["Waiting", "Preparing", "Working", "Preparing rails", "Replying"]
  );

  b.run("resume");
  assert.deepEqual(
    b.rows().map((r) => r.label),
    [
      "Waiting",
      "Preparing",
      "Working",
      "Preparing rails",
      "Working",
      "Replying",
    ],
    "the turn picks up in a row of its own"
  );
  const working = b.rows().filter((r) => r.label === "Working");
  assert.equal(working[0]!.finished !== null, true, "the first is over");
  assert.equal(working[1]!.finished, null, "the second is under way");
  assert.equal(b.rows().at(-1)!.started, null, "Replying has not been reached");
  b.done();
});

// One after another, so neither is ever shown beside the other.
test("a second environment interrupts the turn again", () => {
  const b = board();
  b.run("start", "Waiting", "Preparing", "Working", "Replying");
  b.run("next");
  b.run("next");

  b.run("interrupt", "Preparing rails");
  b.run("resume");
  b.run("interrupt", "Preparing frontend");
  b.run("resume");

  assert.deepEqual(
    b.rows().map((r) => r.label),
    [
      "Waiting",
      "Preparing",
      "Working",
      "Preparing rails",
      "Working",
      "Preparing frontend",
      "Working",
      "Replying",
    ]
  );
  b.done();
});

// It died while preparing, so that is what the checklist should still say.
test("an environment that never finishes keeps the line where it stopped", () => {
  const b = board();
  b.run("start", "Waiting", "Preparing", "Working", "Replying");
  b.run("next");
  b.run("next");
  b.run("interrupt", "Preparing rails");
  b.run("stopped", "It failed.");

  const rails = b.rows().find((r) => r.label === "Preparing rails")!;
  assert.equal(rails.finished !== null, true, "closed off where it got to");
  assert.equal(b.rows().at(-1)!.started, null, "Replying was never reached");
  b.done();
});

test("the first step is timed from the comment to the workflow starting", () => {
  const asked = "2026-09-23T14:25:00Z";
  const b = board({
    ASKED: asked,
    RUN_STARTED: String(Date.parse(asked) + 9_000),
  });
  b.run("start", "Waiting for GitHub", "Preparing", "Working");

  const [queue] = b.rows();
  assert.equal(queue!.finished! - queue!.started!, 9_000);
  assert.equal(b.state_of("1"), "running", "the queue is already behind us");
  b.done();
});

test("without both timestamps the first step is simply under way", () => {
  const b = board({ ASKED: "not a date" });
  b.run("start", "Waiting for GitHub", "Preparing");
  assert.equal(b.state_of("0"), "running");
  assert.equal(b.rows()[0]!.finished, null);
  b.done();
});

test("done closes a row that never started, rather than leaving it pending", () => {
  const b = board();
  b.run("start", "One", "Two");
  b.run("done");
  assert.ok(b.rows().every((r) => r.started !== null && r.finished !== null));
  b.done();
});

// A run that dies has still done some of it, and how long that took is most
// worth reading when something went wrong.
test("stopping keeps what the run managed", () => {
  const asked = "2026-09-23T14:25:00Z";
  const b = board({
    ASKED: asked,
    RUN_STARTED: String(Date.parse(asked) + 4_000),
  });
  b.run("start", "Waiting", "Preparing", "Working", "Replying");
  b.run("next");
  b.run("stopped", "The run failed.");

  assert.equal(b.state_of("0"), "done");
  assert.equal(
    b.rows()[0]!.finished! - b.rows()[0]!.started!,
    4_000,
    "the queue is still timed"
  );
  assert.equal(b.state_of("1"), "done");
  assert.equal(b.state_of("2"), "done", "it was running, so it is closed off");
  assert.equal(
    b.state_of("3"),
    "pending",
    "it never started, so it is not claimed as done"
  );
  b.done();
});
