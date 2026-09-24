#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Answer what is waiting (`first`), or hold the sandbox open for whatever
// comes next (`followups`).
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask } from "../lib/agent.ts";
import { claim } from "../lib/claim.ts";
import { render } from "../lib/mentions.ts";
import { publish } from "../lib/post.ts";
import { again, first, type Situation } from "../lib/prompt.ts";
import { thread } from "../lib/thread.ts";

const temp = process.env.RUNNER_TEMP!;
function progress(...args: string[]) {
  const lock = join(temp, "progress.lock");
  spawnSync("flock", [lock, process.env.PROGRESS_SCRIPT!, ...args], {
    stdio: "inherit",
  });
}

const opening = process.argv[2] !== "followups";

// The development environment runs behind the gate, so this log is the only
// way its output reaches the runner.
if (opening) {
  writeFileSync(join(temp, "dev-up.log"), "");
}
const devLog = spawn(
  "tail",
  ["-n", opening ? "+1" : "0", "-F", join(temp, "dev-up.log")],
  {
    stdio: ["ignore", "inherit", "ignore"],
  }
);

async function turn(prompt: string, resume: boolean) {
  const status = ask(prompt, resume);
  progress("next");

  // Report the agent's failure rather than the empty publish it causes.
  try {
    await publish();
  } catch (error) {
    if (status === 0) {
      throw error;
    }
  }
  progress("next");

  if (status !== 0) {
    throw new Error(`the agent exited ${status}`);
  }
}

const where: Situation = {
  repo: process.env.GITHUB_REPOSITORY!,
  issue: process.env.ISSUE_NUMBER!,
  isPullRequest: process.env.IS_PULL_REQUEST === "yes",
  canPush: process.env.CAN_PUSH === "true",
  pushBlockedBecause: process.env.PUSH_BLOCKED_BECAUSE ?? "",
};

try {
  if (opening) {
    // One run is queued per issue, so a comment displaced from that queue has
    // nothing else looking for it. Take those too.
    const asked = await claim(false);
    if (asked.length === 0) {
      console.error("nothing left to answer");
      progress("done");
    } else {
      // The sandbox is up. `turn` marks the rest.
      progress("next");
      const history = await thread(new Set(asked.map((m) => String(m.id))));
      await turn(
        first(where, history, render(asked), process.env.AGENT_TASK),
        false
      );
    }
  } else {
    while (true) {
      const asked = await claim(true);
      if (!asked.length) {
        break;
      }
      progress(
        "next",
        "Working",
        "Replying",
        `Waiting ${process.env.FOLLOWUP_WINDOW}s for further instructions`
      );
      await turn(again(render(asked)), true);
    }
    progress("done");
  }
} finally {
  devLog.kill();
}
