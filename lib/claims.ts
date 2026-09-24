import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratch } from "./scratch.ts";

// Only claims that have never reached publication are safe to release.
export function remember(comment: number, reaction: number) {
  const dir = scratch("pending-claims");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, String(comment)),
    JSON.stringify({ comment, reaction })
  );
}

export function protect() {
  // A timeout after POST may mean GitHub accepted the reply. Keep its claim.
  rmSync(scratch("pending-claims"), { recursive: true, force: true });
}
