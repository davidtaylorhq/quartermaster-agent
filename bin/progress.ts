#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Keep the run's opening comment up to date as a checklist.
//
//     progress start LABEL...     the list, with the first step under way
//     progress next [LABEL...]    finish the step under way, add these, start
//                                 the next one
//     progress interrupt LABEL    stop the step under way for this one
//     progress resume             finish that, and pick the stopped step up again
//     progress done               finish everything
//     progress stopped WHY        the run ended early; keep what it did
//
// Every row is one line of a single sequence, and each keeps its own clock. A
// step that interrupts another is never beside it, so only one thing is ever
// happening: whatever prepares an environment has to wait its turn.
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
type State = {
  rows: Row[];
  note?: string;
  comment?: string;
  suspended?: string;
};

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

// A step that interrupts another goes in after it, not after the steps the
// line has not reached yet.
function open(label: string): void {
  const at = state.rows.findLastIndex((r) => r.started !== null) + 1;
  state.rows.splice(at, 0, {
    id: String(state.rows.length),
    label,
    started: now,
    finished: null,
  });
}

function close(): Row | undefined {
  const running = state.rows.find(
    (r) => r.started !== null && r.finished === null
  );
  if (running) {
    running.finished = now;
  }
  return running;
}

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
  rest.forEach((label) => {
    state.rows.push({
      id: String(state.rows.length),
      label,
      started: null,
      finished: null,
    });
  });

  close();
  const waiting = state.rows.find((r) => r.started === null);
  if (waiting) {
    waiting.started = now;
  }
  await publish();
} else if (command === "interrupt") {
  const label = rest.join(" ");
  if (!label) {
    console.error("progress interrupt LABEL");
    process.exit(64);
  }
  const stopped = close();
  if (stopped) {
    state.suspended = stopped.label;
  }
  open(label);
  await publish();
} else if (command === "resume") {
  close();
  if (state.suspended) {
    open(state.suspended);
    delete state.suspended;
  }
  await publish();
} else if (command === "done") {
  for (const row of state.rows) {
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
  console.error("progress start|next|interrupt|resume|done|stopped [ARGS...]");
  process.exit(64);
}
