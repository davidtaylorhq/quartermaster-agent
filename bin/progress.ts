#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Keep the run's opening comment up to date as a checklist.
//
//     progress start LABEL...     the list, with the first step under way
//     progress next [LABEL...]    finish the step under way, add these, start
//                                 the next one
//     progress begin ID LABEL     a step of its own, beside whatever is running
//     progress end ID             finish that one
//     progress done               finish everything
//     progress stopped WHY        the run ended early; keep what it did
//
// A development environment starts while a turn is under way, so it gets a row
// of its own rather than a place in the line. Each row keeps its own clock.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { request } from "../lib/github.ts";
import { scratch } from "../lib/scratch.ts";

const OPENING = "On it!";
const MARK = {
  done: ["mark-done.svg", "done"],
  active: ["mark-active.svg", "in progress"],
  pending: ["mark-pending.svg", "not started"],
} as const;

const STATE = process.env.PROGRESS_FILE ?? scratch("progress.json");

type Row = {
  id: string;
  label: string;
  started: number | null;
  finished: number | null;
};
type State = { rows: Row[]; note?: string; comment?: string };

function save(state: State): void {
  writeFileSync(`${STATE}.new`, JSON.stringify(state));
  renameSync(`${STATE}.new`, STATE);
}

function elapsed(row: Row): string {
  if (row.started === null || row.finished === null) {
    return "";
  }
  const ms = Math.max(0, row.finished - row.started);
  return ms < 1000 ? " — <1s" : ` — ${Math.round(ms / 1000)}s`;
}

function render(state: State): string {
  const { rows } = state;
  const assets =
    `https://raw.githubusercontent.com/${process.env.ASSET_REPO}` +
    `/${process.env.ASSET_REF}/assets`;

  const lines = rows.map((row) => {
    const mark =
      row.finished !== null
        ? "done"
        : row.started !== null
          ? "active"
          : "pending";
    const [name, alt] = MARK[mark];
    // Without vertical-align the mark floats above the capitals.
    return (
      `<img src="${assets}/${name}" width="15" height="15" alt="${alt}"` +
      ` style="vertical-align: middle; margin-right: 2px">` +
      ` ${row.label}${elapsed(row)}`
    );
  });

  const run = process.env.RUN_URL ?? "";
  const opening = run
    ? `${OPENING} Follow along with [the logs](${run}).`
    : OPENING;
  const ending = state.note ? `\n\n${state.note}` : "";
  return `${opening}\n\n${lines.join("\n")}${ending}`;
}

async function publish(): Promise<string | undefined> {
  const comment = process.env.COMMENT_ID || state.comment;
  save({ ...state, comment });

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    return comment;
  }
  const drawn = render(state);

  // A checklist that will not update should not end the run.
  let response: Response;
  try {
    response = comment
      ? await request("PATCH", `/repos/${repo}/issues/comments/${comment}`, {
          body: drawn,
        })
      : await request(
          "POST",
          `/repos/${repo}/issues/${process.env.ISSUE_NUMBER}/comments`,
          { body: drawn }
        );
  } catch (error) {
    console.error(`progress: ${error}`);
    return comment;
  }

  const id = comment ?? String(((await response.json()) as { id: number }).id);
  save({ ...state, comment: id });
  return id;
}

// The steps `start` laid out, in the order they happen. A row `begin` adds is
// not one of them and never takes their turn.
const inLine = (row: Row) => /^\d+$/.test(row.id);

const [command, ...rest] = process.argv.slice(2);
const state: State =
  command === "start" || !existsSync(STATE)
    ? { rows: [] }
    : (JSON.parse(readFileSync(STATE, "utf8")) as State);
const now = Date.now();

if (command === "start") {
  state.rows = rest.map((label, i) => ({
    id: String(i),
    label,
    started: null,
    finished: null,
  }));

  // The queue is over before this runs, so its length comes from the two
  // timestamps it was given.
  const began = Number(process.env.RUN_STARTED);
  const asked = Date.parse(process.env.ASKED ?? "");
  const [queue, second] = [state.rows[0], state.rows[1]];
  if (
    queue &&
    second &&
    Number.isFinite(began) &&
    Number.isFinite(asked) &&
    began > asked
  ) {
    Object.assign(queue, { started: asked, finished: began });
    second.started = began;
  } else if (queue) {
    queue.started = now;
  }

  const id = await publish();
  if (id) {
    console.log(id);
  }
} else if (command === "next") {
  // A follow-up turn adds its own steps to the end of the line.
  const last = Math.max(
    -1,
    ...state.rows.filter(inLine).map((r) => Number(r.id))
  );
  rest.forEach((label, i) => {
    state.rows.push({
      id: String(last + 1 + i),
      label,
      started: null,
      finished: null,
    });
  });

  const running = state.rows.find(
    (r) => inLine(r) && r.started !== null && r.finished === null
  );
  if (running) {
    running.finished = now;
  }
  const waiting = state.rows.find((r) => inLine(r) && r.started === null);
  if (waiting) {
    waiting.started = now;
  }
  await publish();
} else if (command === "begin") {
  const [id, label] = rest;
  if (!id || !label) {
    console.error("progress begin ID LABEL");
    process.exit(64);
  }
  const row = state.rows.find((r) => r.id === id);
  if (row) {
    row.started = now;
  } else {
    // Beside what is running, not after the steps that have not run yet.
    const at = state.rows.findLastIndex((r) => r.started !== null) + 1;
    state.rows.splice(at, 0, { id, label, started: now, finished: null });
  }
  await publish();
} else if (command === "end" || command === "done") {
  for (const row of command === "end"
    ? state.rows.filter((r) => r.id === rest[0])
    : state.rows) {
    if (row.started === null) {
      row.started = now;
    }
    if (row.finished === null) {
      row.finished = now;
    }
  }
  await publish();
} else if (command === "stopped") {
  // What it managed is worth keeping: only what was running is closed off, and
  // what it never reached stays unmarked.
  for (const row of state.rows) {
    if (row.started !== null && row.finished === null) {
      row.finished = now;
    }
  }
  state.note = rest.join(" ");
  await publish();
} else {
  console.error("progress start|next|begin|end|done|stopped [ARGS...]");
  process.exit(64);
}
