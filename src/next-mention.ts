#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Take the mentions nobody has answered yet, and say so by reacting.
//
// The reaction is what stops two runs answering the same comment.
import { writeFileSync } from "node:fs";
import { listComments, request, paginate, TRUSTED, type Comment } from "./github.ts";

const CLAIM = "eyes";
const MACRO = process.env.MENTION!;
// Older than this is a backlog, and answering a backlog at once is worse
// than leaving it.
const MAX_AGE_HOURS = Number(process.env.MAX_COMMENT_AGE_HOURS ?? "1");
const WINDOW = Number(process.env.FOLLOWUP_WINDOW ?? "60");

const repo = process.env.GITHUB_REPOSITORY!;
const issue = process.env.ISSUE_NUMBER!;
const out = process.env.MENTION_FILE!;

async function claimed(comment: Comment): Promise<boolean> {
  // The count arrives with the comment; only a non-zero one needs a lookup.
  if (!comment.reactions?.eyes) return false;
  const reactions = await paginate<{ content: string; user: { login: string } }>(
    `/repos/${repo}/issues/comments/${comment.id}/reactions`,
  );
  return reactions.some((r) => r.content === CLAIM && r.user.login.endsWith("[bot]"));
}

async function react(id: number): Promise<boolean> {
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
    .filter((c) => TRUSTED.has(c.author_association))
    .filter((c) => (c.body ?? "").includes(MACRO))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function take(cutoff: string): Promise<boolean> {
  const taken = [];
  for (const c of await outstanding(cutoff)) {
    if (await claimed(c)) continue;
    if (!(await react(c.id))) continue;
    taken.push({ id: c.id, author: c.user.login, body: c.body, created_at: c.created_at });
  }
  if (taken.length === 0) return false;

  writeFileSync(out, JSON.stringify(taken));
  console.error(
    `answering ${taken.length} comment(s): ${taken.map((c) => c.id).join(", ")}`,
  );
  return true;
}

export async function claim(wait: boolean): Promise<boolean> {
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
  const deadline = Date.now() + (wait ? WINDOW * 1000 : 0);

  while (true) {
    if (await take(cutoff)) return true;
    if (Date.now() >= deadline) {
      console.error("nothing outstanding");
      return false;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await claim(process.argv.includes("--wait"))) ? 0 : 1);
}
