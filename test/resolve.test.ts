import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

let api: Server;
let pull: unknown;

before(async () => {
  api = createServer((_req, res) => {
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(pull));
  });
  await new Promise<void>((done) => api.listen(0, "127.0.0.1", done));
});

after(() => api?.close());

async function resolve(env: NodeJS.ProcessEnv) {
  const dir = mkdtempSync(join(tmpdir(), "resolve-"));
  const out = join(dir, "out");
  const exported = join(dir, "env");
  writeFileSync(out, "");
  writeFileSync(exported, "");

  // Async: the stub API answers from this process's own event loop.
  const child = spawn(
    join(import.meta.dirname, "..", "bin", "resolve.ts"),
    [],
    {
      env: {
        ...process.env,
        GITHUB_OUTPUT: out,
        GITHUB_ENV: exported,
        GITHUB_API_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`,
        ...env,
      },
    }
  );
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  child.stdout.resume();
  const status = await new Promise<number | null>((done) =>
    child.on("close", done)
  );

  const read = (f: string) =>
    Object.fromEntries(
      readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const at = l.indexOf("=");
          return [l.slice(0, at), l.slice(at + 1)];
        })
    );
  const wrote = read(out);
  const exportedEnv = read(exported);
  rmSync(dir, { recursive: true, force: true });

  assert.equal(status, 0, `resolve exited ${status}: ${stderr}`);
  return { wrote, exported: exportedEnv };
}

const where = {
  GITHUB_REPOSITORY: "acme/thing",
  ISSUE_NUMBER: "7",
  DEFAULT_BRANCH: "main",
};

test("an issue reads the default branch and cannot push", async () => {
  const { wrote } = await resolve({ ...where, IS_PULL_REQUEST: "no" });
  assert.equal(wrote.base_sha, "", "an issue has nothing to diff against");
  assert.equal(wrote.ref, "refs/heads/main");
  assert.equal(wrote.head_ref, "main");
  assert.equal(wrote.can_push, "false");
  assert.match(wrote.reason!, /not a pull request/);
});

test("a pull request in this repository is fetched by its own ref", async () => {
  pull = {
    head: { ref: "a-branch", repo: { full_name: "acme/thing" } },
    base: { sha: "base1" },
  };
  const { wrote, exported } = await resolve({
    ...where,
    IS_PULL_REQUEST: "yes",
  });
  assert.equal(wrote.ref, "refs/pull/7/head");
  assert.equal(wrote.head_ref, "a-branch");
  assert.equal(wrote.can_push, "true");
  assert.equal(exported.HEAD_REF, "a-branch");
  assert.equal(
    wrote.base_sha,
    "base1",
    "the run fetches this so the agent can diff against it"
  );
});

// The base repository has no such branch, so only the pull request's own ref
// finds the code. A fork branch named `main` would otherwise check out ours.
test("a fork's pull request is fetched by ref and cannot push", async () => {
  pull = {
    head: { ref: "main", repo: { full_name: "someone/fork" } },
    base: { sha: "base2" },
  };
  const { wrote } = await resolve({ ...where, IS_PULL_REQUEST: "yes" });
  assert.equal(wrote.ref, "refs/pull/7/head", "never the branch name");
  assert.equal(wrote.head_ref, "main");
  assert.equal(wrote.can_push, "false");
  assert.match(wrote.reason!, /fork/);
  assert.equal(
    wrote.base_sha,
    "base2",
    "a fork's diff is worth as much as anyone's"
  );
});

test("a pull request onto the default branch cannot push", async () => {
  pull = {
    head: { ref: "main", repo: { full_name: "acme/thing" } },
    base: { sha: "base3" },
  };
  const { wrote } = await resolve({ ...where, IS_PULL_REQUEST: "yes" });
  assert.equal(wrote.can_push, "false");
  assert.match(wrote.reason!, /the branch is main/);
});
