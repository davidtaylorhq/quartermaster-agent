#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Publish whatever a run left behind.
//
// The conversation posts its own turns. This is what runs when it could not:
// a crash leaves a reply on disk that somebody should still be told about.
import { publish } from "./post.ts";

try {
  await publish();
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
}
