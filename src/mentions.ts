#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Render the comments this turn is answering.
//
// Several may be waiting at once, and someone correcting themselves a few
// seconds later means the last word is the one that counts.
import { readFileSync } from "node:fs";

type Mention = { id: number; author: string; body: string };

const mentions = JSON.parse(
  readFileSync(process.env.MENTION_FILE!, "utf8"),
) as Mention[];

if (process.env.IDS_ONLY) {
  console.log(mentions.map((m) => m.id).join(" "));
} else {
  if (mentions.length > 1) {
    console.log(
      `${mentions.length} comments are waiting. Where they disagree, the last one wins.\n`,
    );
  }
  for (const m of mentions) {
    console.log(`@${m.author}:`);
    console.log(m.body.trim());
    console.log();
  }
}
