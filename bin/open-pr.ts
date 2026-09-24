#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
import { readFileSync } from "node:fs";
import { policy } from "../lib/branches.ts";
import { openPullRequest } from "../lib/open-pr.ts";

console.log(
  JSON.stringify(
    await openPullRequest(
      policy(),
      process.env.GITHUB_REPOSITORY!,
      JSON.parse(readFileSync(0, "utf8"))
    )
  )
);
