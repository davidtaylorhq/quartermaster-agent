import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// eslint-disable-next-line qunit/no-test-expect-argument -- node:test options
test(
  "term-llm bootstraps provider configuration before it becomes read-only",
  { skip: !process.env.TERM_LLM_BINARY },
  (t) => {
    const home = mkdtempSync(join(tmpdir(), "bootstrap-"));
    const config = join(home, ".config/term-llm");
    mkdirSync(config, { recursive: true });
    t.after(() => {
      chmodSync(config, 0o755);
      rmSync(home, { recursive: true, force: true });
    });
    const env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      ANTHROPIC_API_KEY: "bootstrap-test-secret",
    };
    const run = () =>
      spawnSync(process.env.TERM_LLM_BINARY!, ["agents", "list"], {
        env,
        encoding: "utf8",
        timeout: 10000,
      });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const contents = readFileSync(join(config, "config.yaml"), "utf8");
    assert.match(contents, /default_provider: anthropic/);
    assert.doesNotMatch(contents, /bootstrap-test-secret/);
    for (const file of readdirSync(config)) {
      chmodSync(join(config, file), 0o444);
    }
    chmodSync(config, 0o555);
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(join(config, "config.yaml"), "utf8"), contents);
  }
);
