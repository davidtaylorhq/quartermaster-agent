#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Work out what the agent is looking at, and whether it may push to it.
import { appendFileSync } from "node:fs";
import { request } from "../lib/github.ts";

const repo = process.env.GITHUB_REPOSITORY!;
const issue = process.env.ISSUE_NUMBER!;
const defaultBranch = process.env.DEFAULT_BRANCH!;

type Resolved = { ref: string; head_ref: string; can_push: boolean; reason: string };

async function resolve(): Promise<Resolved> {
  if (process.env.IS_PULL_REQUEST !== "yes") {
    // Everything downstream wants a branch; only pushing differs.
    return {
      ref: `refs/heads/${defaultBranch}`,
      head_ref: defaultBranch,
      can_push: false,
      reason: "this is an issue, not a pull request",
    };
  }

  const pr = (await (await request("GET", `/repos/${repo}/pulls/${issue}`)).json()) as {
    head: { ref: string; repo: { full_name: string } | null };
  };
  const ref = `refs/pull/${issue}/head`;
  const head_ref = pr.head.ref;

  // The job token cannot write to a fork, and the credential that could is
  // broader than this job should ever hold.
  if (pr.head.repo?.full_name !== repo) {
    return { ref, head_ref, can_push: false, reason: "the branch lives in a fork, which this job cannot push to" };
  }
  if (head_ref === defaultBranch) {
    return { ref, head_ref, can_push: false, reason: `the branch is ${defaultBranch}` };
  }
  return { ref, head_ref, can_push: true, reason: "" };
}

const out = await resolve();
appendFileSync(
  process.env.GITHUB_OUTPUT!,
  Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
);
// A job-level `env:` cannot reach a step's outputs, and several steps want these.
appendFileSync(
  process.env.GITHUB_ENV!,
  [
    `HEAD_REF=${out.head_ref}`,
    `CAN_PUSH=${out.can_push}`,
    `PUSH_BLOCKED_BECAUSE=${out.reason}`,
  ].join("\n") + "\n",
);
