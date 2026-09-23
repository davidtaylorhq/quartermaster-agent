#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Keep the run's opening comment up to date as a checklist.
//
//     progress start LABEL...     the list, with the first step under way
//     progress next [LABEL...]    finish this step, do these next, start the next
//     progress done               finish this step; nothing follows
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { request } from "./github.ts";
import { scratch } from "./scratch.ts";

const OPENING = "On it!";
const MARK = {
  done: ["mark-done.svg", "done"],
  active: ["mark-active.svg", "in progress"],
  pending: ["mark-pending.svg", "not started"],
} as const;

const STATE = process.env.PROGRESS_FILE ?? scratch("progress.json");

function save(state: unknown): void {
  writeFileSync(`${STATE}.new`, JSON.stringify(state));
  renameSync(`${STATE}.new`, STATE);
}

type State = { labels: string[]; at: number; since: number; took: number[]; comment?: string };

function elapsed(ms: number): string {
  return ms < 1000 ? "<1s" : `${Math.round(ms / 1000)}s`;
}

function render(labels: string[], at: number, took: number[]): string {
  const assets =
    `https://raw.githubusercontent.com/${process.env.ASSET_REPO}` +
    `/${process.env.ASSET_REF}/assets`;

  const lines = labels.map((label, i) => {
    const state = i < at ? "done" : i === at ? "active" : "pending";
    const [name, alt] = MARK[state];
    const spent = took[i] === undefined ? "" : ` — ${elapsed(took[i]!)}`;
    // Without vertical-align the mark floats above the capitals.
    return (
      `<img src="${assets}/${name}" width="15" height="15" alt="${alt}"` +
      ` style="vertical-align: middle; margin-right: 2px">` +
      ` ${label}${spent}`
    );
  });

  const run = process.env.RUN_URL ?? "";
  const opening = run ? `${OPENING} Follow along with [the logs](${run}).` : OPENING;
  return `${opening}\n\n${lines.join("\n")}`;
}

async function publish(next: Omit<State, "comment">): Promise<string | undefined> {
  const saved = existsSync(STATE)
    ? (JSON.parse(readFileSync(STATE, "utf8")) as { comment?: string })
    : {};
  const comment = process.env.COMMENT_ID || saved.comment;
  const { labels, at, took } = next;
  save({ ...next, comment });

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return comment;
  const drawn = render(labels, at, took);

  // A checklist that will not update should not end the run.
  let response: Response;
  try {
    response = comment
      ? await request("PATCH", `/repos/${repo}/issues/comments/${comment}`, { body: drawn })
      : await request("POST", `/repos/${repo}/issues/${process.env.ISSUE_NUMBER}/comments`, { body: drawn });
  } catch (error) {
    console.error(`progress: ${error}`);
    return comment;
  }

  const id = comment ?? String(((await response.json()) as { id: number }).id);
  save({ ...next, comment: id });
  return id;
}

const [command, ...labels] = process.argv.slice(2);

if (command === "start") {
  // The queue is over before this runs, so its length comes from the two
  // timestamps it was given.
  const started = Number(process.env.RUN_STARTED);
  const asked = Date.parse(process.env.ASKED ?? "");
  const timed = Number.isFinite(started) && Number.isFinite(asked) && started > asked;

  const id = await publish(
    timed
      ? { labels, at: 1, since: started, took: [started - asked] }
      : { labels, at: 0, since: Date.now(), took: [] },
  );
  if (id) console.log(id);
} else if (command === "next" || command === "done") {
  const saved = JSON.parse(readFileSync(STATE, "utf8")) as State;
  const took = saved.took.slice();
  took[saved.at] = Date.now() - saved.since;

  if (command === "done") {
    await publish({ labels: saved.labels, at: saved.labels.length, since: Date.now(), took });
  } else {
    saved.labels.splice(saved.at + 1, 0, ...labels);
    await publish({
      labels: saved.labels,
      at: Math.min(saved.at + 1, saved.labels.length),
      since: Date.now(),
      took,
    });
  }
} else {
  console.error("progress start|next|done [LABEL...]");
  process.exit(64);
}
