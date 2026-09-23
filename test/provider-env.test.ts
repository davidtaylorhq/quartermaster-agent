import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PLACEHOLDER } from "../lib/inference.ts";

const script = join(import.meta.dirname, "..", "bin", "provider-env.ts");

function read(blob: string) {
  const dir = mkdtempSync(join(tmpdir(), "creds-"));
  const dest = join(dir, "provider.env");
  const routes = join(dir, "routes.json");
  const ghEnv = join(dir, "github.env");
  writeFileSync(ghEnv, "");
  const run = spawnSync(script, [dest, routes], {
    encoding: "utf8",
    env: { ...process.env, PROVIDER_ENV: blob, GITHUB_ENV: ghEnv },
  });
  const result = {
    ...run,
    file: run.status === 0 ? readFileSync(dest, "utf8") : "",
    // eslint-disable-next-line no-bitwise -- the permission bits are the point
    mode: run.status === 0 ? statSync(dest).mode & 0o777 : 0,
    exported: run.status === 0 ? readFileSync(ghEnv, "utf8") : "",
    routes: run.status === 0 ? readFileSync(routes, "utf8") : "",
  };
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("a value containing = is kept whole", () => {
  const { file } = read("OPENAI_API_KEY=sk-abc=def==\n");
  assert.equal(file, "OPENAI_API_KEY=sk-abc=def==\n");
});

test("every value is masked before anything can echo it", () => {
  const { stdout } = read("A=first-value-here\nB=second-value-here\n");
  assert.match(stdout, /::add-mask::first-value-here/);
  assert.match(stdout, /::add-mask::second-value-here/);
});

test("the names are logged and the values are not", () => {
  const { stdout } = read("MISTRAL_API_KEY=sk-secret-value\n");
  assert.match(stdout, /given to the sandbox: MISTRAL_API_KEY/);
  assert.doesNotMatch(
    stdout
      .split("\n")
      .filter((l) => !l.startsWith("::"))
      .join("\n"),
    /sk-secret-value/
  );
});

test("the file is readable only by the runner", () => {
  assert.equal(read("A=value-here\n").mode, 0o600);
});

test("only the path and the names leave in the environment", () => {
  const { exported } = read("A=a-secret-value\n");
  assert.match(exported, /PROVIDER_ENV_NAMES=A/);
  assert.doesNotMatch(exported, /a-secret-value/);
});

test("a provider the proxy can reach keeps its key here", () => {
  const { file, routes, stdout } = read("ANTHROPIC_API_KEY=sk-ant-secret\n");
  assert.equal(file, `ANTHROPIC_API_KEY=${PLACEHOLDER}\n`);
  assert.deepEqual(JSON.parse(routes), {
    routes: {
      anthropic: {
        upstream: "https://api.anthropic.com",
        key: "sk-ant-secret",
      },
    },
    tunnels: {},
  });
  assert.match(stdout, /reached through the proxy: anthropic/);
});

test("a provider run as a command keeps its key here too", () => {
  const { file, routes, exported, stdout } = read(
    "CLAUDE_CODE_OAUTH_TOKEN=oat-secret\n"
  );
  assert.equal(file, `CLAUDE_CODE_OAUTH_TOKEN=${PLACEHOLDER}\n`);
  assert.deepEqual(JSON.parse(routes), {
    routes: {},
    tunnels: {
      "api.anthropic.com": {
        upstream: "https://api.anthropic.com",
        key: "oat-secret",
      },
    },
  });
  assert.match(stdout, /reached through the tunnel: api\.anthropic\.com/);
  assert.match(exported, /MODEL_TUNNEL_HOSTS=api\.anthropic\.com/);
});

test("a provider the proxy cannot reach still goes to the sandbox", () => {
  const { file, routes } = read("OPENAI_API_KEY=sk-openai-secret\n");
  assert.equal(file, "OPENAI_API_KEY=sk-openai-secret\n");
  assert.deepEqual(JSON.parse(routes), { routes: {}, tunnels: {} });
});

test("carriage returns from a pasted secret are dropped", () => {
  assert.equal(read("A=value-here\r\n").file, "A=value-here\n");
});

for (const [why, blob] of [
  ["a line with no =", "NOEQUALS\n"],
  ["a name that is not a variable", "1BAD=x\n"],
  ["a name with no value", "EMPTY=\n"],
] as const) {
  test(`${why} stops the run`, () => {
    assert.equal(read(blob).status, 1);
  });
}
