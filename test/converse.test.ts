import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("explicit tasks execute once without claiming or authorizing mentions", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "task-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "output"));
  writeFileSync(
    join(dir, "docker"),
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.RUNNER_TEMP + "/calls", JSON.stringify(process.argv.slice(2)) + "\\n");
fs.writeFileSync(process.env.RUNNER_TEMP + "/output/finish.json", JSON.stringify({reply: "Resolved backport conflicts"}));
`,
    { mode: 0o755 }
  );
  writeFileSync(join(dir, "progress"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const requests: string[] = [];
  const api = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") {
      res.end(
        JSON.stringify([
          {
            id: 123,
            body: "Automated backport failed",
            created_at: "2020-01-01T00:00:00Z",
            author_association: "NONE",
            user: { login: "patch-triage[bot]" },
          },
        ])
      );
    } else {
      res.end('{"id":456}');
    }
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => api.close());
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    RUNNER_TEMP: dir,
    GITHUB_API_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`,
    GITHUB_REPOSITORY: "o/r",
    ISSUE_NUMBER: "7",
    IS_PULL_REQUEST: "yes",
    CLAIMED: "123",
    MENTION: "@bot",
    TRUSTED_ASSOCIATIONS: "OWNER",
    FOLLOWUP_WINDOW: "60",
    AGENT_TASK: "Resolve the conflicts reported by the backport workflow.",
    PROGRESS_SCRIPT: join(dir, "progress"),
    MAX_TURNS: "5",
    AGENT_TIMEOUT: "1m",
  };
  for (const phase of ["first", "followups"]) {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        join(import.meta.dirname, "../bin/converse.ts"),
        phase,
      ],
      { env }
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const [status] = await once(child, "close");
    assert.equal(status, 0, output);
  }
  const calls = readFileSync(join(dir, "calls"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].at(-1).includes(env.AGENT_TASK));
  assert.deepEqual(requests, [
    "GET /repos/o/r/issues/7/comments?per_page=100",
    "POST /repos/o/r/issues/7/comments",
  ]);
});
