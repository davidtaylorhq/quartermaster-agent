// Where a reply's time went, for the footer.
//
// Three stretches that meet end to end: how long the comment sat before a
// runner picked it up, how long the sandbox took to stand up, and how long the
// agent worked. A follow-up has no sandbox to build, so it reports two.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { scratch } from "./scratch.ts";

const FILE = scratch("timing.json");

type Marks = { asked: number; ready: number; agent: number };

export function began(asked: string, booting: boolean): void {
  const ready = booting ? Number(process.env.RUN_STARTED) : 0;
  writeFileSync(FILE, JSON.stringify({ asked: Date.parse(asked), ready, agent: Date.now() }));
}

function round(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

export function spent(now = Date.now()): string {
  if (!existsSync(FILE)) return "";
  const { asked, ready, agent } = JSON.parse(readFileSync(FILE, "utf8")) as Marks;
  if (!Number.isFinite(asked) || !Number.isFinite(agent)) return "";

  // A run that never recorded its start cannot say where the wait went, so it
  // reports the whole of it as one stretch rather than inventing a split.
  const stretches = ready
    ? [[ready - asked, "waiting"], [agent - ready, "boot"], [now - agent, "working"]]
    : [[agent - asked, "waiting"], [now - agent, "working"]];

  return (stretches as [number, string][]).map(([ms, name]) => `${round(ms)} ${name}`).join(", ");
}
