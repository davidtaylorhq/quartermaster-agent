import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "environments.ts");

function parse(yaml: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "envs-"));
  const source = join(dir, "environments.yml");
  const dest = join(dir, "out.json");
  if (yaml !== null) writeFileSync(source, yaml);
  const run = spawnSync(script, [source, dest], { encoding: "utf8" });
  const out = run.status === 0 ? JSON.parse(readFileSync(dest, "utf8")) : null;
  rmSync(dir, { recursive: true, force: true });
  return { ...run, out };
}

const ONE = `environments:
  - name: rails
    description: Ruby and the database.
    image: discourse/discourse_dev:release
    cmd: /sbin/boot
    user: discourse
    mount: /src
    setup: |
      bundle install
      bin/rake db:migrate
`;

test("a block scalar keeps its newlines", () => {
  const { out } = parse(ONE);
  assert.equal(out.rails.setup, "bundle install\nbin/rake db:migrate\n");
});

test("a value with a colon in it survives", () => {
  assert.equal(parse(ONE).out.rails.image, "discourse/discourse_dev:release");
});

test("what a project leaves out comes back empty, not missing", () => {
  assert.equal(parse(ONE).out.rails.entrypoint, "");
});

test("no file at all is no environments, not a failure", () => {
  const { status, out } = parse(null);
  assert.equal(status, 0);
  assert.deepEqual(out, {});
});

for (const [why, yaml] of [
  ["a name that is not a word", "environments:\n  - name: a b\n    image: x\n    mount: /src\n"],
  ["two environments sharing a name", "environments:\n  - name: a\n    image: x\n    mount: /src\n  - name: a\n    image: y\n    mount: /src\n"],
  ["a setting nobody recognises", "environments:\n  - name: a\n    image: x\n    mount: /src\n    shims: [ruby]\n"],
  ["no image", "environments:\n  - name: a\n    mount: /src\n"],
  ["no mount", "environments:\n  - name: a\n    image: x\n"],
  ["not a list", "environments: nope\n"],
] as const) {
  test(`${why} stops the run`, () => {
    const run = parse(yaml);
    assert.equal(run.status, 1, `expected a refusal, got: ${run.stdout}`);
    assert.match(run.stderr, /^environments: /);
  });
}
