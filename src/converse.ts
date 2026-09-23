#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Answer what is waiting (`first`), or hold the sandbox open for whatever
// comes next (`followups`). Two invocations so the log says how long the
// first reply took.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { load } from "./credentials.ts";
import { render, waiting } from "./mentions.ts";
import { claim } from "./next-mention.ts";
import { publish } from "./post.ts";
import { again, first, type Situation } from "./prompt.ts";
import { thread } from "./thread.ts";

const temp = process.env.RUNNER_TEMP!;
const sandbox = JSON.parse(readFileSync(join(temp, "sandbox.json"), "utf8")) as {
  container: string;
  home: string;
  sshOptions: string;
  credentials: string[];
};

// docker passes credentials by name, so they must be in this process too.
load(process.env.PROVIDER_ENV_FILE, process.env);

function progress(...args: string[]) {
  spawnSync(process.env.PROGRESS_SCRIPT!, args, { stdio: "inherit" });
}

const opening = process.argv[2] !== "followups";

// The development environment runs behind the gate; this log is the only way
// its output reaches the runner. A later step picks it up where it left off.
if (opening) writeFileSync(join(temp, "dev-up.log"), "");
const devLog = spawn("tail", ["-n", opening ? "+1" : "0", "-F", join(temp, "dev-up.log")], {
  stdio: ["ignore", "inherit", "ignore"],
});

function ask(prompt: string, resume: boolean): number {
  // Last turn's output must not be mistaken for this one's.
  for (const leftover of ["finish.json", "findings.jsonl"]) {
    spawnSync("docker", ["exec", "-u", "agent", sandbox.container, "rm", "-f", `${sandbox.home}/${leftover}`]);
    rmSync(join(temp, leftover), { force: true });
  }

  const command = [
    "term-llm ask",
    "--agent quartermaster",
    process.env.PROVIDER ? `--provider "${process.env.PROVIDER}"` : "",
    `--session-db ${sandbox.home}/session.db`,
    resume ? "--resume" : "",
    "--yolo --text --stats",
    `--max-turns ${process.env.MAX_TURNS}`,
    `--timeout ${process.env.AGENT_TIMEOUT}`,
    '"$QM_PROMPT"',
  ].filter(Boolean).join(" ");

  const run = spawnSync("docker", [
    "exec", "-i", "-u", "agent", "-w", "/src",
    "-e", `HOME=${sandbox.home}`,
    "-e", `GIT_SSH_COMMAND=ssh ${sandbox.sshOptions}`,
    "-e", "SHELL=/usr/local/bin/qm-shell",
    "-e", `QM_PROMPT=${prompt}`,
    ...sandbox.credentials.flatMap((name) => ["-e", name]),
    sandbox.container, "bash", "-lc",
    `export PATH="$HOME/.local/bin:$PATH"; ${command} 2>&1`,
  ], { stdio: ["ignore", "inherit", "inherit"] });

  for (const produced of ["finish.json", "findings.jsonl"]) {
    spawnSync("docker", ["cp", `${sandbox.container}:${sandbox.home}/${produced}`, join(temp, produced)], {
      stdio: "ignore",
    });
  }
  return run.status ?? 1;
}

async function turn(prompt: string, resume: boolean) {
  const status = ask(prompt, resume);
  progress("next");

  // A failed agent leaves nothing to publish; report the failure, not that.
  try {
    await publish();
  } catch (error) {
    if (status === 0) throw error;
  }
  progress("next");

  if (status !== 0) throw new Error(`the agent exited ${status}`);
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
    // The sandbox is up; the two inside `turn` carry it to the wait.
    progress("next");
    const asked = waiting();
    const history = await thread(new Set(asked.map((m) => String(m.id))));
    await turn(first(where, history, render(asked)), false);
  } else {
    while (await claim(true)) {
      progress("next", "Working", "Replying", `Waiting ${process.env.FOLLOWUP_WINDOW}s for further instructions`);
      await turn(again(render(waiting())), true);
    }
    progress("done");
  }
} finally {
  devLog.kill();
}
