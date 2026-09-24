import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type BranchPolicy = {
  head: string;
  defaultBranch: string;
  canPushHead: boolean;
  patterns: string[];
  initial: Record<string, string>;
};

export function patterns(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((pattern) => {
      new RegExp(`^(?:${pattern})$`).test("");
      return pattern;
    });
}

export function allowed(rules: BranchPolicy, branch: string): boolean {
  if (branch === rules.defaultBranch) {
    return false;
  }
  if (branch === rules.head) {
    return rules.canPushHead;
  }
  return rules.patterns.some((pattern) =>
    new RegExp(`^(?:${pattern})$`).test(branch)
  );
}

export function policy(): BranchPolicy {
  return JSON.parse(readFileSync(process.env.BRANCH_POLICY!, "utf8"));
}

export function git(...args: string[]): string {
  const auth = Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString(
    "base64"
  );
  return execFileSync("git", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function remote(): string {
  return `https://github.com/${process.env.GITHUB_REPOSITORY}.git`;
}
