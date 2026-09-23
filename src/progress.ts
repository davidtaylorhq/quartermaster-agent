#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Keep the run's opening comment up to date as a checklist.
//
//     progress start LABEL...     the list, with the first step under way
//     progress next [LABEL...]    finish this step, do these next, start the next
//     progress done               finish this step; nothing follows
import { readFileSync, writeFileSync } from "node:fs";

const OPENING = "On it!";
const MARK = {
  done: ["mark-done.svg", "done"],
  active: ["mark-active.svg", "in progress"],
  pending: ["mark-pending.svg", "not started"],
} as const;

const STATE = process.env.PROGRESS_FILE ?? "/tmp/progress.json";

function render(labels: string[], at: number): string {
  const assets =
    `https://raw.githubusercontent.com/${process.env.ASSET_REPO}` +
    `/${process.env.ASSET_REF}/assets`;

  const lines = labels.map((label, i) => {
    const state = i < at ? "done" : i === at ? "active" : "pending";
    const [name, alt] = MARK[state];
    // An image sits its bottom on the baseline by default, which leaves a
    // round mark floating above the capitals.
    return (
      `<img src="${assets}/${name}" width="15" height="15" alt="${alt}"` +
      ` style="vertical-align: middle; margin-right: 2px">` +
      ` ${label}`
    );
  });

  const run = process.env.RUN_URL ?? "";
  const opening = run ? `${OPENING} Follow along with [the logs](${run}).` : OPENING;
  return `${opening}\n\n${lines.join("\n")}`;
}

async function publish(labels: string[], at: number) {
  writeFileSync(STATE, JSON.stringify({ labels, at }));

  const comment = process.env.COMMENT_ID;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!comment || !repo) return;

  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues/comments/${comment}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${process.env.GH_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: render(labels, at) }),
    },
  );
  if (!response.ok) {
    console.error(`progress: GitHub said ${response.status}: ${await response.text()}`);
  }
}

const [command, ...labels] = process.argv.slice(2);

if (command === "start") {
  await publish(labels, 0);
} else if (command === "next" || command === "done") {
  const saved = JSON.parse(readFileSync(STATE, "utf8")) as {
    labels: string[];
    at: number;
  };
  if (command === "done") {
    await publish(saved.labels, saved.labels.length);
  } else {
    saved.labels.splice(saved.at + 1, 0, ...labels);
    await publish(saved.labels, Math.min(saved.at + 1, saved.labels.length));
  }
} else {
  console.error("progress start|next|done [LABEL...]");
  process.exit(64);
}
