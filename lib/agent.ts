import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { load } from "./credentials.ts";
import { CLIENT, HOME } from "./runtime.ts";

export function ask(prompt: string, resume: boolean): number {
  const temp = process.env.RUNNER_TEMP!;
  const credentials = load(process.env.PROVIDER_ENV_FILE, process.env);

  // Last turn's output must not be mistaken for this one's.
  for (const leftover of ["finish.json", "findings.jsonl"]) {
    rmSync(join(temp, "output", leftover), { force: true });
  }

  const term = [
    `${HOME}/.local/bin/term-llm`,
    "ask",
    "--agent",
    "workflow-agent",
    ...(process.env.PROVIDER ? ["--provider", process.env.PROVIDER] : []),
    "--session-db",
    `${HOME}/session.db`,
    ...(resume ? ["--resume"] : []),
    "--yolo",
    "--text",
    "--stats",
    "--max-turns",
    process.env.MAX_TURNS!,
    "--timeout",
    process.env.AGENT_TIMEOUT!,
    prompt,
  ];

  const run = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "-u",
      "agent",
      "-w",
      HOME,
      "-e",
      `HOME=${HOME}`,
      "-e",
      `PATH=${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin`,
      ...credentials.flatMap((name) => ["-e", name]),
      CLIENT,
      ...term,
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );

  return run.status ?? 1;
}
