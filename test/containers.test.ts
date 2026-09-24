import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "containers-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "docker.jsonl");
  writeFileSync(log, "");
  writeFileSync(join(dir, "environments.json"), "{}");
  writeFileSync(join(dir, "provider.env"), "ANTHROPIC_API_KEY=model-secret\n");
  writeFileSync(
    join(dir, "project-config.yaml"),
    "default_provider: anthropic\n"
  );
  writeFileSync(
    join(dir, "docker"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify({args, key: process.env.ANTHROPIC_API_KEY}) + "\\n");
if (args.includes("curl")) process.exit(Number(process.env.CURL_EXIT || 0));
if (args[0] === "inspect") process.stdout.write("172.17.0.2\\n");
if (args.includes("ask")) process.exit(Number(process.env.AGENT_EXIT || 0));
`
  );
  for (const name of ["curl", "sleep", "sudo"]) {
    writeFileSync(
      join(dir, name),
      `#!/bin/sh\nexit ${name === "curl" ? '"${CURL_EXIT:-0}"' : "0"}\n`
    );
  }
  for (const name of ["docker", "curl", "sleep", "sudo"]) {
    chmodSync(join(dir, name), 0o755);
  }
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    DOCKER_LOG: log,
    RUNNER_TEMP: dir,
    BRIDGE_IP: "172.17.0.1",
    SSH_PORT: "2222",
    FORWARD_PORT: "2223",
    CLIENT_KEY: join(dir, "clientkey"),
    AGENT_DIR: join(root, "agent"),
    GATE_USER: "runner",
    SANDBOX_IMAGE: "test-image",
    WORKTREE: join(dir, "worktree"),
    GITHUB_REPOSITORY: "owner/repo",
    ENVIRONMENTS_JSON: join(dir, "environments.json"),
    TERM_LLM_CONFIG: join(dir, "project-config.yaml"),
    PROVIDER_ENV_FILE: join(dir, "provider.env"),
    GH_TOKEN: "github-secret",
    MAX_TURNS: "5",
    AGENT_TIMEOUT: "1m",
  };
  function run(name: string) {
    const out = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(root, "bin", name)],
      {
        env,
        encoding: "utf8",
      }
    );
    assert.equal(out.status, 0, out.stderr);
  }
  function calls(): { args: string[]; key?: string }[] {
    return readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return { dir, env, run, calls };
}

test("workspace tools and the model client run in separate containers", (t) => {
  const { dir, run, calls } = fixture(t);
  run("containers-up.ts");
  const started = calls().filter(({ args }) => args[0] === "run");
  assert.equal(started.length, 2);
  const workspace = started.find(({ args }) =>
    args.includes("workflow-agent-sandbox")
  )!;
  const agent = started.find(({ args }) =>
    args.includes("workflow-agent-client")
  )!;
  assert.ok(workspace.args.includes(`${dir}/worktree:/src`));
  assert.ok(
    agent.args.includes(`${dir}/agent-config:/home/agent/.config/term-llm:ro`)
  );
  assert.ok(agent.args.includes(`${dir}/output:/output:rw`));
  assert.ok(agent.args.includes(`${dir}/clientkey:/home/agent/.ssh/gate:ro`));
  assert.ok(!agent.args.includes(`${dir}/worktree:/src`));
  assert.ok(agent.args.includes("OUTPUT_DIR=/output"));
  for (const { args } of started) {
    assert.ok(!args.includes("-p"));
    assert.ok(!args.includes("--privileged"));
    assert.doesNotMatch(
      args.join(" "),
      /docker.sock|GH_TOKEN|API_KEY|provider.env/
    );
  }
  const serving = calls().find(({ args }) =>
    args.includes("/usr/local/bin/workspace-start")
  )!.args;
  assert.ok(serving.includes("workflow-agent-sandbox"));
  assert.equal(serving[0], "run");
  assert.ok(serving.includes("/src"));
  assert.ok(serving.some((arg) => arg.startsWith("GIT_SSH_COMMAND=")));
  assert.doesNotMatch(serving.join(" "), /GH_TOKEN|API_KEY|HTTPS_PROXY/);

  const mcp = JSON.parse(
    readFileSync(join(dir, "agent-config/mcp.json"), "utf8")
  );
  assert.equal(
    mcp.servers.workspace.url,
    "http://workflow-agent-sandbox:8080/mcp"
  );
  assert.match(
    mcp.servers.workspace.headers.Authorization,
    /^Bearer [a-f0-9]{64}$/
  );
  assert.equal(mcp.servers.github.command, "ssh");
  assert.equal(
    readFileSync(join(dir, "agent-config/config.yaml"), "utf8"),
    "default_provider: anthropic\n"
  );
  assert.ok(calls().every(({ args }) => args[0] !== "cp"));
  assert.ok(
    workspace.args.includes(`${dir}/clientkey:/home/agent/.ssh/gate:ro`)
  );
});

test("declared environments expose the static dev client read-only", (t) => {
  const { dir, run, calls } = fixture(t);
  writeFileSync(
    join(dir, "environments.json"),
    JSON.stringify({ rails: { image: "test", mount: "/src" } })
  );
  run("containers-up.ts");
  const args = calls().find((call) => call.args[0] === "run")!.args;
  assert.ok(args.some((arg) => arg.endsWith("/bin/dev:/usr/local/bin/dev:ro")));
  assert.ok(args.includes("SSH_PORT=2222"));
  assert.ok(args.includes("GATE_USER=runner"));
  assert.ok(calls().every((call) => !call.args.includes("bash")));
});

test("an unavailable workspace server stops startup", (t) => {
  const { env } = fixture(t);
  const out = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(root, "bin/containers-up.ts")],
    {
      env: { ...env, CURL_EXIT: "7" },
      encoding: "utf8",
    }
  );
  assert.equal(out.status, 1);
  assert.match(out.stderr, /workspace MCP server did not start/);
});

for (const resume of [false, true]) {
  test(`model credentials stay in the agent container and stale output is removed (resume=${resume})`, (t) => {
    const { dir, env, calls } = fixture(t);
    mkdirSync(join(dir, "output"));
    writeFileSync(join(dir, "output", "finish.json"), "stale reply");
    writeFileSync(join(dir, "output", "findings.jsonl"), "stale finding");
    const out = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        `import { ask } from ${JSON.stringify(join(root, "lib/agent.ts"))}; process.exit(ask("hello", ${resume}));`,
      ],
      { env, encoding: "utf8" }
    );
    assert.equal(out.status, 0, out.stderr);
    const invoked = calls().find(({ args }) => args.includes("ask"))!;
    assert.equal(invoked.key, "model-secret");
    assert.ok(invoked.args.includes("ANTHROPIC_API_KEY"));
    assert.ok(invoked.args.includes("workflow-agent-client"));
    assert.equal(invoked.args.includes("--resume"), resume);
    assert.doesNotMatch(
      invoked.args.join(" "),
      /GH_TOKEN|github-secret|model-secret|\/src|workflow-agent-sandbox/
    );
    assert.equal(calls().length, 1);
    assert.throws(
      () => readFileSync(join(dir, "output", "finish.json")),
      /ENOENT/
    );
    assert.throws(
      () => readFileSync(join(dir, "output", "findings.jsonl")),
      /ENOENT/
    );
  });
}

test("an absent optional provider configuration does not prevent startup", (t) => {
  const { dir, run, calls } = fixture(t);
  rmSync(join(dir, "project-config.yaml"));
  run("containers-up.ts");
  const bootstrap = calls().find(({ args }) => args.includes("--rm"))!;
  assert.ok(bootstrap.args.includes("agents"));
  assert.ok(
    bootstrap.args.includes(
      `${dir}/agent-config:/home/agent/.config/term-llm:rw`
    )
  );
  assert.ok(bootstrap.args.includes("ANTHROPIC_API_KEY"));
  assert.doesNotMatch(
    bootstrap.args.join(" "),
    /GH_TOKEN|github-secret|model-secret/
  );
});
