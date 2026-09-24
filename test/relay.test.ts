import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function relay(t: { after: (fn: () => void) => void }, canPush = true) {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const work = join(dir, "work");
  const upstream = join(dir, "upstream.git");
  const relayRepo = join(dir, "relay.git");
  const pushed = join(dir, "pushed");
  const env = {
    ...process.env,
    HOME: dir,
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(dir, "init", "-q", "--bare", upstream);
  git(dir, "init", "-q", "-b", "topic", work);
  writeFileSync(join(work, "file"), "initial\n");
  git(work, "add", "file");
  git(work, "commit", "-qm", "Initial");
  git(work, "push", "-q", upstream, "HEAD:refs/heads/topic");
  git(dir, "clone", "-q", "--bare", work, relayRepo);
  const initial = git(work, "rev-parse", "HEAD");
  writeFileSync(pushed, initial);
  // Keep the production GitHub URL and exercise real pushes against a local remote.
  git(
    dir,
    "config",
    "--global",
    `url.${upstream}.insteadOf`,
    "https://github.com/test/repo.git"
  );
  mkdirSync(join(dir, ".workflow-agent"));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    join(dir, ".workflow-agent/env"),
    Object.entries({
      HEAD_REF: "topic",
      PUSHED: pushed,
      BOT_NAME: "testbot",
      GH_TOKEN: "test-token",
      GITHUB_REPOSITORY: "test/repo",
      CAN_PUSH: String(canPush),
      PUSH_BLOCKED_BECAUSE: "read-only run",
    })
      .map(([name, value]) => `export ${name}=${quote(value)}\n`)
      .join("")
  );
  for (const [source, hook] of [
    ["git-update", "update"],
    ["git-post-receive", "post-receive"],
  ]) {
    cpSync(
      join(import.meta.dirname, "../bin", source!),
      join(relayRepo, "hooks", hook!)
    );
  }
  writeFileSync(join(work, "file"), "changed\n");
  git(work, "commit", "-qam", "Change");
  const changed = git(work, "rev-parse", "HEAD");
  const push = (ref = "topic") =>
    spawnSync("git", ["push", relayRepo, `HEAD:refs/heads/${ref}`], {
      cwd: work,
      env,
      encoding: "utf8",
    });
  return {
    dir,
    work,
    upstream,
    relayRepo,
    pushed,
    initial,
    changed,
    git,
    push,
  };
}

test("an allowed push forwards the commit and advances the lease", (t) => {
  const r = relay(t);
  const result = r.push();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(r.git(r.upstream, "rev-parse", "refs/heads/topic"), r.changed);
  assert.equal(readFileSync(r.pushed, "utf8"), r.changed);
  assert.match(result.stderr, /testbot: pushed/);
});

test("the update hook rejects a different branch", (t) => {
  const r = relay(t);
  const result = r.push("another");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only topic may be pushed/);
  assert.equal(r.git(r.upstream, "rev-parse", "refs/heads/topic"), r.initial);
  assert.throws(() => r.git(r.relayRepo, "rev-parse", "refs/heads/another"));
});

test("a read-only run keeps the commit in the relay without forwarding it", (t) => {
  const r = relay(t, false);
  const result = r.push();
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    /kept in the sandbox, not sent to GitHub: read-only run/
  );
  assert.equal(r.git(r.relayRepo, "rev-parse", "refs/heads/topic"), r.changed);
  assert.equal(r.git(r.upstream, "rev-parse", "refs/heads/topic"), r.initial);
  assert.equal(readFileSync(r.pushed, "utf8"), r.initial);
});

test("a moved upstream branch is preserved and the relay rolls back", (t) => {
  const r = relay(t);
  r.git(r.work, "checkout", "-q", "-b", "other", r.initial);
  writeFileSync(join(r.work, "other"), "someone else's commit\n");
  r.git(r.work, "add", "other");
  r.git(r.work, "commit", "-qm", "Concurrent change");
  const concurrent = r.git(r.work, "rev-parse", "HEAD");
  r.git(r.work, "push", "-q", r.upstream, "HEAD:refs/heads/topic");
  r.git(r.work, "checkout", "-q", "topic");
  const result = r.push();
  assert.equal(
    result.status,
    0,
    "Git reports acceptance by the relay, not the upstream"
  );
  assert.match(result.stderr, /GitHub refused the push/);
  assert.equal(r.git(r.upstream, "rev-parse", "refs/heads/topic"), concurrent);
  assert.equal(r.git(r.relayRepo, "rev-parse", "refs/heads/topic"), r.initial);
  assert.equal(readFileSync(r.pushed, "utf8"), r.initial);
});
