#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Keep the run's opening comment up to date as a checklist.
//
//     progress start LABEL...     the list, with the first step under way
//     progress next [LABEL...]    finish this step, do these next, start the next
//     progress done               finish this step; nothing follows
//
// Each step keeps how long it took, so the finished list says where the time
// went. The first step is the queue, which is over before this runs at all.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { scratch } from "./scratch.ts";

const OPENING = "On it!";
const MARK = {
  done: ["mark-done.svg", "done"],
  active: ["mark-active.svg", "in progress"],
  pending: ["mark-pending.svg", "not started"],
} as const;

const STATE = process.env.PROGRESS_FILE ?? scratch("progress.json");

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
    // An image sits its bottom on the baseline by default, which leaves a
    // round mark floating above the capitals.
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

// The checklist lives in one comment, written where it is first drawn and
// edited after that.
async function publish(next: Omit<State, "comment">): Promise<string | undefined> {
  const saved = existsSync(STATE)
    ? (JSON.parse(readFileSync(STATE, "utf8")) as { comment?: string })
    : {};
  const comment = process.env.COMMENT_ID || saved.comment;
  const { labels, at, took } = next;
  writeFileSync(STATE, JSON.stringify({ ...next, comment }));

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return comment;

  const response = await fetch(
    comment
      ? `https://api.github.com/repos/${repo}/issues/comments/${comment}`
      : `https://api.github.com/repos/${repo}/issues/${process.env.ISSUE_NUMBER}/comments`,
    {
      method: comment ? "PATCH" : "POST",
      headers: {
        authorization: `Bearer ${process.env.GH_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: render(labels, at, took) }),
    },
  );
  if (!response.ok) {
    console.error(`progress: GitHub said ${response.status}: ${await response.text()}`);
    return comment;
  }

  const id = comment ?? String(((await response.json()) as { id: number }).id);
  writeFileSync(STATE, JSON.stringify({ ...next, comment: id }));
  return id;
}

const [command, ...labels] = process.argv.slice(2);

if (command === "start") {
  // The queue and the runner coming up are already over, and the two
  // timestamps for them are the only ones nothing else could have recorded.
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
