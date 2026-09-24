#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
import { readFileSync, writeFileSync } from "node:fs";
import {
  allowed,
  type BranchPolicy,
  git,
  patterns,
  remote,
} from "../lib/branches.ts";

const policy: BranchPolicy = {
  head: process.env.HEAD_REF!,
  defaultBranch: process.env.DEFAULT_BRANCH!,
  canPushHead: process.env.CAN_PUSH === "true",
  patterns: patterns(process.env.ALLOWED_BRANCHES ?? ""),
  initial: Object.create(null),
};
if (!policy.defaultBranch) {
  throw new Error("DEFAULT_BRANCH is required");
}
if (policy.patterns.length) {
  for (const line of git("ls-remote", "--heads", remote()).split("\n")) {
    const [sha, ref] = line.split(/\s+/);
    if (ref?.startsWith("refs/heads/") && allowed(policy, ref.slice(11))) {
      policy.initial[ref.slice(11)] = sha!;
    }
  }
}
// The original branch leases against the checkout, even if it has since moved.
policy.initial[policy.head] = readFileSync(process.env.PUSHED!, "utf8").trim();
writeFileSync(process.env.BRANCH_POLICY!, JSON.stringify(policy));
