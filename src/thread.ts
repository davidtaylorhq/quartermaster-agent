#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Print what has already been said on this issue.
//
// The agent has no memory between mentions and the thread is where the
// conversation actually lives, so it goes in the prompt rather than depending
// on the agent choosing to look it up.
import { listComments, type Comment } from "./github.ts";

const KEEP = 20;
const WIDTH = 800;

// Anyone else can comment on a pull request. Their words belong in the record,
// but the agent should know whose words carry weight.
const TRUSTED = new Set(
  (process.env.TRUSTED_ASSOCIATIONS ?? "OWNER,MEMBER,COLLABORATOR").split(","),
);

// The bot's own bookkeeping is not conversation. The checklist is recognised
// by how it opens, which is also what it is: a sentence saying work has started.
const NOISE = ["Superseded by a newer mention.", "The run failed.", "Starting…", "On it!"];
// Both spellings of our signature: comments posted before it gained its
// wrapper are still in the thread, and trimming at the inner one would leave
// the outer tag behind.
const FOOTERS = ['<div align="right"><sub>:robot:', "<sub>:robot:"];

function withoutFooter(body: string): string {
  const at = FOOTERS.map((f) => body.indexOf(f)).filter((i) => i !== -1);
  return at.length === 0 ? body : body.slice(0, Math.min(...at)).trimEnd();
}

const skip = new Set((process.env.SKIP_COMMENT_IDS ?? "").split(" ").filter(Boolean));

function useful(c: Comment): boolean {
  const body = (c.body ?? "").trim();
  return body !== "" && !NOISE.some((n) => body.startsWith(n));
}

const all = await listComments(
  process.env.GITHUB_REPOSITORY!,
  process.env.ISSUE_NUMBER!,
);
let kept = all.filter((c) => useful(c) && !skip.has(String(c.id)));

if (kept.length > 0) {
  const dropped = kept.length - KEEP;
  if (dropped > 0) {
    console.log(`(${dropped} earlier comment(s) not shown; read them if you need them)\n`);
    kept = kept.slice(-KEEP);
  }

  for (const c of kept) {
    // The signature is ours, not something anyone said.
    let body = withoutFooter(c.body.trim());
    if (body.length > WIDTH) body = body.slice(0, WIDTH) + " […]";

    let who: string = c.user.login;
    if (who === (process.env.BOT_LOGIN ?? "github-actions[bot]")) {
      who = "you";
    } else if (!TRUSTED.has(c.author_association)) {
      who = `${who} (cannot write to this repository)`;
    }
    console.log(`@${who}:`);
    console.log(body);
    console.log();
  }
}
