#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { allowed, git, policy, remote } from "../lib/branches.ts";

const rules = policy();
const say = (message: string) =>
  console.error(`${process.env.BOT_NAME}: ${message}`);
const zero = (sha: string) => /^0+$/.test(sha);

function check(ref: string, next: string): string {
  if (!ref.startsWith("refs/heads/") || zero(next)) {
    throw new Error("tags and branch deletion are not permitted");
  }
  const branch = ref.slice(11);
  // Keep the original checkout's local commits even when forwarding is disabled.
  if (branch !== rules.head && !allowed(rules, branch)) {
    throw new Error(`branch ${branch} is not allowed`);
  }
  if (branch === rules.defaultBranch) {
    throw new Error("default branch pushes are not permitted");
  }
  return branch;
}

if (process.argv[2] === "update") {
  try {
    check(process.argv[3]!, process.argv[5]!);
  } catch (error) {
    say(String(error));
    process.exit(1);
  }
} else {
  for (const line of readFileSync(0, "utf8").trim().split("\n")) {
    const [old, next, ref] = line.split(" ");
    const branch = check(ref!, next!);
    if (!allowed(rules, branch)) {
      say(
        `kept in the sandbox, not sent to GitHub: ${process.env.PUSH_BLOCKED_BECAUSE ?? "pushing is unavailable"}`
      );
      continue;
    }
    const leaseFile =
      branch === rules.head
        ? process.env.PUSHED!
        : `${process.env.PUSHED}.${createHash("sha256").update(branch).digest("hex")}`;
    const expected = existsSync(leaseFile)
      ? readFileSync(leaseFile, "utf8").trim()
      : Object.hasOwn(rules.initial, branch)
        ? rules.initial[branch]!
        : "";
    try {
      git(
        "push",
        `--force-with-lease=${ref}:${expected}`,
        remote(),
        `${next}:${ref}`
      );
      writeFileSync(leaseFile, next!);
      say(`pushed ${next!.slice(0, 12)} to ${branch} on GitHub`);
    } catch (error) {
      git("update-ref", ...(zero(old!) ? ["-d", ref!] : [ref!, old!]));
      say(
        `GitHub refused the push; the commit is only in the sandbox: ${String(error)}`
      );
      say(
        "if the branch moved, start a new run from its current head before pushing"
      );
    }
  }
}
