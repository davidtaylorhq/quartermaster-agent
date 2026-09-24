import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { load } from "./credentials.ts";

export function ask(prompt: string, resume: boolean): number {
  const temp = process.env.RUNNER_TEMP!;
  const agent = JSON.parse(readFileSync(join(temp, "agent.json"), "utf8")) as {
    container: string;
    home: string;
  };
  const credentials = load(process.env.PROVIDER_ENV_FILE, process.env);

  // Last turn's output must not be mistaken for this one's.
  for (const leftover of ["finish.json", "findings.jsonl"]) {
    spawnSync("docker", [
      "exec",
      "-u",
      "agent",
      agent.container,
      "rm",
      "-f",
      `${agent.home}/${leftover}`,
    ]);
    rmSync(join(temp, leftover), { force: true });
  }

  const term = [
    `${agent.home}/.local/bin/term-llm`,
    "ask",
    "--agent",
    "workflow-agent",
    ...(process.env.PROVIDER ? ["--provider", process.env.PROVIDER] : []),
    "--session-db",
    `${agent.home}/session.db`,
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
      agent.home,
      "-e",
      `HOME=${agent.home}`,
      "-e",
      `PATH=${agent.home}/.local/bin:/usr/local/bin:/usr/bin:/bin`,
      ...credentials.flatMap((name) => ["-e", name]),
      agent.container,
      ...term,
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );

  for (const produced of ["finish.json", "findings.jsonl"]) {
    spawnSync(
      "docker",
      [
        "cp",
        `${agent.container}:${agent.home}/${produced}`,
        join(temp, produced),
      ],
      {
        stdio: "ignore",
      }
    );
  }
  return run.status ?? 1;
}
