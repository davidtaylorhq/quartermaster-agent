#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Take the mentions nobody has answered yet, and say so by reacting.
//
// The reaction is what stops two runs answering the same comment.
import { writeFileSync } from "node:fs";
import { listComments, request, TRUSTED, type Comment } from "./github.ts";

const CLAIM = "eyes";
const MACRO = process.env.MENTION!;
// Older than this is a backlog, and answering a backlog at once is worse
// than leaving it.
const MAX_AGE_HOURS = Number(process.env.MAX_COMMENT_AGE_HOURS ?? "1");
const WINDOW = Number(process.env.FOLLOWUP_WINDOW ?? "60");

const repo = process.env.GITHUB_REPOSITORY!;
const issue = process.env.ISSUE_NUMBER!;
const out = process.env.MENTION_FILE!;

// Reacting is the claim, and GitHub answers 201 when it added the reaction
// and 200 when this account had already added it. So asking is claiming, and
// there is no moment between the two for another run to fit into.
async function react(id: number): Promise<boolean> {
  if (String(id) === process.env.CLAIMED) return true;

  try {
    const response = await request("POST", `/repos/${repo}/issues/comments/${id}/reactions`, {
      content: CLAIM,
    });
    return response.status === 201;
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
