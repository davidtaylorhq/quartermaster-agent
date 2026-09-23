import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const gate = join(import.meta.dirname, "host-gate");
let home: string;
let relay: string;
let stubs: string;

function ask(command: string, input = "") {
  return spawnSync("sh", [gate], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      SSH_ORIGINAL_COMMAND: command,
      PATH: `${stubs}:${process.env.PATH}`,
    },
  });
}

before(() => {
  home = mkdtempSync(join(tmpdir(), "gate-home-"));
  relay = join(home, "relay.git");
  stubs = join(home, "stubs");
  mkdirSync(join(home, ".quartermaster"), { recursive: true });
  mkdirSync(stubs);

  execFileSync("git", ["init", "-q", "--bare", relay]);
  const work = join(home, "work");
  execFileSync("git", ["init", "-q", work]);
  const env = {
    cwd: work,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@e",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@e",
    },
  };
  writeFileSync(join(work, "f"), "hello\n");
  execFileSync("git", ["add", "-A"], env);
  execFileSync("git", ["commit", "-qm", "first"], env);
  execFileSync("git", ["push", "-q", relay, "HEAD:refs/heads/topic"], env);

  // Standing in for docker, so a test can see what the gate would have run.
  writeFileSync(join(stubs, "docker"), '#!/bin/sh\necho "docker $*"\n');
  chmodSync(join(stubs, "docker"), 0o755);
  writeFileSync(
    join(home, ".quartermaster", "dev-boot"),
    "#!/bin/sh\nexit 0\n"
  );
  chmodSync(join(home, ".quartermaster", "dev-boot"), 0o755);

  writeFileSync(
    join(home, ".quartermaster", "environments.json"),
    JSON.stringify({ rails: { user: "discourse", mount: "/src" } })
  );
  writeFileSync(
    join(home, ".quartermaster", "env"),
    [
      `export RELAY=${relay}`,
      `export BOT_NAME=testbot`,
      `export MCP_IMAGE=ghcr.io/example/mcp:1`,
      `export ENVIRONMENTS=${join(home, ".quartermaster", "environments.json")}`,
      "",
    ].join("\n")
  );
});

after(() => rmSync(home, { recursive: true, force: true }));

test("a verb nobody offered is refused", () => {
  const out = ask("rm -rf /");
  assert.equal(out.status, 1);
  assert.match(out.stderr, /testbot: not permitted/);
});

test("reading the repository is not something the gate does", () => {
  // The sandbox fetches through the forwarder, so this verb has no business
  // here and the relay must not serve it.
  assert.equal(ask("git-upload-pack '/relay.git'").status, 1);
});

test("the client's own arguments are discarded", () => {
  // git sends a repository path; the gate supplies its own and ignores it.
  const out = ask("git-receive-pack '/etc/passwd'");
  assert.match(out.stdout, /refs\/heads\/topic/);
});

test("an environment nobody declared is refused, and the real ones named", () => {
  const out = ask("dev nonesuch");
  assert.equal(out.status, 1);
  assert.match(out.stderr, /no environment called 'nonesuch'/);
  assert.match(out.stderr, /this project has: rails/);
});

test("a declared environment runs as the user and at the mount it declared", () => {
  const out = ask("dev rails");
  assert.match(
    out.stdout,
    /docker exec -i -u discourse -w \/src -e CI=1 quartermaster_dev_rails bash -l/
  );
});

test("the MCP server is given the token by name, never by value", () => {
  const out = ask("mcp");
  assert.match(out.stdout, /-e GITHUB_PERSONAL_ACCESS_TOKEN/);
  assert.doesNotMatch(out.stdout, /GITHUB_PERSONAL_ACCESS_TOKEN=/);
  assert.match(out.stdout, /GITHUB_READ_ONLY/);
});
