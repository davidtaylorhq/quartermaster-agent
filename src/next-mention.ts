#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Take the mentions nobody has answered yet, and say so by reacting.
//
// A run may find several waiting, and the reaction is what stops two runs
// answering the same one. Claiming is a single reaction rather than a read
// and a write, so there is no window between deciding and saying so.
import { writeFileSync } from "node:fs";
import { listComments, request, paginate, type Comment } from "./github.ts";

const CLAIM = "eyes";
const ALLOWED = new Set(
  (process.env.TRUSTED_ASSOCIATIONS ?? "OWNER,MEMBER,COLLABORATOR").split(","),
);
const MACRO = process.env.MENTION!;
// Old enough that nobody is still waiting for an answer. Anything further back
// is a backlog, and answering a backlog at once is worse than leaving it.
const MAX_AGE_HOURS = Number(process.env.MAX_COMMENT_AGE_HOURS ?? "1");
const WINDOW = Number(process.env.FOLLOWUP_WINDOW ?? "60");

const repo = process.env.GITHUB_REPOSITORY!;
const issue = process.env.ISSUE_NUMBER!;
const out = process.env.MENTION_FILE!;
const wait = process.argv.includes("--wait");

async function claimed(comment: Comment): Promise<boolean> {
  // The count comes with the comment. Nought means nobody has reacted at all,
  // which settles it without asking; anything else needs to know who.
  if (!comment.reactions?.eyes) return false;
  const reactions = await paginate<{ content: string; user: { login: string } }>(
    `/repos/${repo}/issues/comments/${comment.id}/reactions`,
  );
  return reactions.some((r) => r.content === CLAIM && r.user.login.endsWith("[bot]"));
}

async function claim(id: number): Promise<boolean> {
  try {
    await request("POST", `/repos/${repo}/issues/comments/${id}/reactions`, {
      content: CLAIM,
    });
    return true;
  } catch (error) {
    console.error(`could not claim ${id}: ${error}`);
    return false;
  }
}

async function outstanding(cutoff: string): Promise<Comment[]> {
  // Ask only for what could possibly be outstanding. Polling every few seconds
  // for every comment on a long thread is a lot of pages for an answer that is
  // almost always "nothing new".
  const all = await listComments(repo, issue, cutoff);
  return all
    .filter((c) => c.created_at >= cutoff)
    .filter((c) => !c.user.login.endsWith("[bot]"))
    .filter((c) => ALLOWED.has(c.author_association))
    .filter((c) => (c.body ?? "").includes(MACRO))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function take(cutoff: string): Promise<boolean> {
  const taken = [];
  for (const c of await outstanding(cutoff)) {
    if (await claimed(c)) continue;
    if (!(await claim(c.id))) continue;
    taken.push({ id: c.id, author: c.user.login, body: c.body, created_at: c.created_at });
  }
  if (taken.length === 0) return false;

  writeFileSync(out, JSON.stringify(taken));
  console.error(
    `answering ${taken.length} comment(s): ${taken.map((c) => c.id).join(", ")}`,
  );
  return true;
}

const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000)
  .toISOString()
  .replace(/\.\d+Z$/, "Z");
const deadline = Date.now() + (wait ? WINDOW * 1000 : 0);

while (true) {
  if (await take(cutoff)) process.exit(0);
  if (Date.now() >= deadline) {
    console.error("nothing outstanding");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
