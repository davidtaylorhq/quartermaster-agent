#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Publishes what a crashed run left on disk. A run that lives posts its own.
import { publish } from "./post.ts";

try {
  await publish();
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
}
