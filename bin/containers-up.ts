#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { load } from "../lib/credentials.ts";
import { CLIENT, HOME, NETWORK, WORKSPACE } from "../lib/runtime.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
function run(command: string, ...args: string[]) {
  execFileSync(command, args, { stdio: "inherit" });
}

const temp = required("RUNNER_TEMP");
const image = required("SANDBOX_IMAGE");
const bridge = required("BRIDGE_IP");
const port = required("SSH_PORT");
const user = required("GATE_USER");
const key = required("CLIENT_KEY");
const worktree = required("WORKTREE");
const forwardPort = required("FORWARD_PORT");
const repo = required("GITHUB_REPOSITORY");
const source = required("AGENT_DIR");
const environments = Object.entries(
  JSON.parse(readFileSync(required("ENVIRONMENTS_JSON"), "utf8"))
) as [string, { description?: string }][];
const config = join(temp, "agent-config");
const output = join(temp, "output");
const agent = join(config, "agents/workflow-agent");
const token = randomBytes(32).toString("hex");
console.log(`::add-mask::${token}`);
const url = `http://${WORKSPACE}:8080/mcp`;
const sshConfig = join(temp, "ssh-config");
writeFileSync(
  sshConfig,
  `Host workflow-gate
  HostName host.docker.internal
  User ${user}
  Port ${port}
  IdentityFile ${HOME}/.ssh/gate
  BatchMode yes
  ConnectTimeout 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`
);

mkdirSync(join(config, "agents"), { recursive: true });
cpSync(source, agent, { recursive: true });
cpSync(join(source, "skills"), join(config, "skills"), { recursive: true });
if (environments.length) {
  appendFileSync(
    join(agent, "system.md"),
    `
## Development environments

Through the workspace shell, run commands in one of these environments:

${environments.map(([name, env]) => `    ${name} — ${env.description ?? ""}`).join("\n")}

Name the environment before the command:

    dev ${environments[0]![0]} <command>

The workspace has git and little else. Commands needing a runtime run in an environment, at its mount point.
The first command into an environment takes a few minutes while it starts; afterwards they are quick. Do not start one you have nothing to run in.
`
  );
}
writeFileSync(
  join(config, "mcp.json"),
  JSON.stringify({
    servers: {
      github: {
        command: "ssh",
        args: ["-T", "workflow-gate", "mcp"],
      },
      workspace: {
        type: "http",
        url,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  }),
  { mode: 0o640 }
);
if (
  process.env.TERM_LLM_CONFIG &&
  existsSync(process.env.TERM_LLM_CONFIG) &&
  readFileSync(process.env.TERM_LLM_CONFIG).length
) {
  cpSync(process.env.TERM_LLM_CONFIG, join(config, "config.yaml"));
}
const group = String(process.getgid!());
run("sudo", "chown", "-R", `1000:${group}`, config, sshConfig);
run("sudo", "install", "-d", "-o", "1000", "-g", group, "-m", "2770", output);
// Let term-llm perform its own provider detection before freezing the config.
if (!existsSync(join(config, "config.yaml"))) {
  const credentials = load(process.env.PROVIDER_ENV_FILE, process.env);
  run(
    "docker",
    "run",
    "--rm",
    "-u",
    "agent",
    "-e",
    `HOME=${HOME}`,
    "-v",
    `${config}:${HOME}/.config/term-llm:rw`,
    ...credentials.flatMap((name) => ["-e", name]),
    image,
    `${HOME}/.local/bin/term-llm`,
    "agents",
    "list"
  );
}
run("docker", "network", "create", NETWORK);
const common = [
  "--network",
  NETWORK,
  "--add-host",
  `host.docker.internal:${bridge}`,
  "-v",
  `${key}:${HOME}/.ssh/gate:ro`,
  "-v",
  `${sshConfig}:${HOME}/.ssh/config:ro`,
];
run(
  "docker",
  "run",
  "-d",
  "--name",
  WORKSPACE,
  ...common,
  "-u",
  "agent",
  "-w",
  "/src",
  "-e",
  `HOME=${HOME}`,
  "-v",
  `${worktree}:/src`,
  "-v",
  `${join(import.meta.dirname, "workspace-start")}:/usr/local/bin/workspace-start:ro`,
  ...(environments.length
    ? ["-v", `${join(import.meta.dirname, "dev")}:/usr/local/bin/dev:ro`]
    : []),
  "-e",
  `FORWARD_PORT=${forwardPort}`,
  "-e",
  `GITHUB_REPOSITORY=${repo}`,
  "-e",
  `MCP_TOKEN=${token}`,
  image,
  "/usr/local/bin/workspace-start"
);
run(
  "docker",
  "run",
  "-d",
  "--name",
  CLIENT,
  ...common,
  "-v",
  `${config}:${HOME}/.config/term-llm:ro`,
  "-v",
  `${output}:/output:rw`,
  "-e",
  "OUTPUT_DIR=/output",
  image
);

for (let attempt = 0; attempt < 30; attempt++) {
  const check = spawnSync(
    "docker",
    [
      "exec",
      CLIENT,
      "curl",
      "--silent",
      "--fail",
      "--output",
      "/dev/null",
      "--max-time",
      "2",
      "-H",
      `Authorization: Bearer ${token}`,
      "-H",
      "Content-Type: application/json",
      "-H",
      "Accept: application/json, text/event-stream",
      "--data",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "workflow-agent", version: "1" },
        },
      }),
      url,
    ],
    { stdio: "inherit" }
  );
  if (check.status === 0) {
    process.exit(0);
  }
  const status = spawnSync(
    "docker",
    ["inspect", "-f", "{{.State.Running}}", WORKSPACE],
    { encoding: "utf8" }
  );
  if (status.stdout.trim() !== "true") {
    break;
  }
  await setTimeout(1000);
}
spawnSync("docker", ["logs", WORKSPACE], { stdio: "inherit" });
throw new Error("workspace MCP server did not start");
