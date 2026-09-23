// The footer's arithmetic. The stretches must meet end to end, so that the
// numbers add up to the time somebody actually waited.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let began: typeof import("./timing.ts").began;
let spent: typeof import("./timing.ts").spent;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "timing-"));
  process.env.RUNNER_TEMP = dir;
  // The module fixes its path on load, so each case gets its own copy.
  ({ began, spent } = await import(`./timing.ts?${dir}`));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("nothing recorded says nothing", () => {
  assert.equal(spent(), "");
});

test("an opening turn splits the wait from the boot", () => {
  const asked = new Date("2026-09-23T14:25:00Z");
  process.env.RUN_STARTED = String(asked.getTime() + 8_000);

  const agentStarted = asked.getTime() + 26_000;
  writeFileSync(
    join(dir, "timing.json"),
    JSON.stringify({ asked: asked.getTime(), ready: Number(process.env.RUN_STARTED), agent: agentStarted }),
  );

  assert.equal(spent(agentStarted + 5_000), "8s waiting, 18s boot, 5s working");
});

test("a follow-up has no sandbox to build, so it reports two", () => {
  const asked = new Date("2026-09-23T14:26:00Z");
  writeFileSync(
    join(dir, "timing.json"),
    JSON.stringify({ asked: asked.getTime(), ready: 0, agent: asked.getTime() + 3_000 }),
  );

  assert.equal(spent(asked.getTime() + 9_000), "3s waiting, 6s working");
});

test("began records the boot only when it is an opening turn", () => {
  const asked = "2026-09-23T14:25:00Z";
  process.env.RUN_STARTED = String(Date.parse(asked) + 1_000);

  began(asked, true);
  assert.match(spent(), /waiting, \d+s boot, \d+s working$/);

  began(asked, false);
  assert.match(spent(), /^\d+s waiting, \d+s working$/);
});

test("a clock that disagrees never prints a negative", () => {
  writeFileSync(
    join(dir, "timing.json"),
    JSON.stringify({ asked: 10_000, ready: 9_000, agent: 11_000 }),
  );
  assert.equal(spent(12_000), "0s waiting, 2s boot, 1s working");
});

test("an unreadable timestamp is left out rather than guessed at", () => {
  writeFileSync(join(dir, "timing.json"), JSON.stringify({ asked: NaN, ready: 0, agent: 1 }));
  assert.equal(spent(), "");
});
