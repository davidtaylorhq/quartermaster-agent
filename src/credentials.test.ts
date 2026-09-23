import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "./credentials.ts";

function withFile(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), "creds-"));
  const file = join(dir, "provider.env");
  writeFileSync(file, contents);
  const env: NodeJS.ProcessEnv = {};
  const names = load(file, env);
  rmSync(dir, { recursive: true, force: true });
  return { names, env };
}

test("a credential reaches the environment docker is called from", () => {
  const { names, env } = withFile("CLAUDE_CODE_OAUTH_TOKEN=sk-value\n");
  assert.deepEqual(names, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sk-value");
});

test("a value containing = survives the round trip", () => {
  assert.equal(withFile("K=a=b==\n").env.K, "a=b==");
});

test("no file is no credentials rather than a crash", () => {
  assert.deepEqual(load("/nowhere/at/all", {}), []);
  assert.deepEqual(load(undefined, {}), []);
});
