// Take the mentions nobody has answered yet. Reacting is what claims one, so
// two runs cannot answer the same comment.
import { writeFileSync } from "node:fs";
import { type Comment, listComments, request, TRUSTED } from "./github.ts";
import { scratch } from "./scratch.ts";

const CLAIM = "eyes";
const MACRO = process.env.MENTION!;
// Older than this is a backlog, and a backlog should not be answered at once.
const MAX_AGE_HOURS = Number(process.env.MAX_COMMENT_AGE_HOURS ?? "1");
const WINDOW = Number(process.env.FOLLOWUP_WINDOW ?? "60");

const repo = process.env.GITHUB_REPOSITORY!;
const issue = process.env.ISSUE_NUMBER!;
const out = scratch("mention.json");

// GitHub answers 201 when it added the reaction and 200 when this account had
// already added it, so one request both claims and checks.
//
// `already` is the comment this run reacted to before it had the scripts to
// claim anything. Only the first claim may take that on trust: afterwards
// GitHub's 200 is the truth, and a run that kept the exemption would answer
// that comment once per follow-up.
async function react(
  id: number,
  already: string | undefined
): Promise<boolean> {
  if (already !== undefined && String(id) === already) {
    return true;
  }

  try {
    const response = await request(
      "POST",
      `/repos/${repo}/issues/comments/${id}/reactions`,
      {
        content: CLAIM,
      }
    );
    return response.status === 201;
  } catch (error) {
    console.error(`could not claim ${id}: ${error}`);
    return false;
  }
}

async function outstanding(cutoff: string): Promise<Comment[]> {
  // The cutoff keeps a poll every few seconds from reading the whole thread.
  const all = await listComments(repo, issue, cutoff);
  return all
    .filter((c) => c.created_at >= cutoff)
    .filter((c) => !c.user.login.endsWith("[bot]"))
    .filter((c) => TRUSTED.has(c.author_association))
    .filter((c) => (c.body ?? "").includes(MACRO))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function take(
  cutoff: string,
  already: string | undefined
): Promise<boolean> {
  const taken = [];
  for (const c of await outstanding(cutoff)) {
    if (!(await react(c.id, already))) {
      continue;
    }
    taken.push({
      id: c.id,
      author: c.user.login,
      body: c.body,
      created_at: c.created_at,
    });
  }
  writeFileSync(out, JSON.stringify(taken));
  if (taken.length === 0) {
    return false;
  }

  console.error(
    `answering ${taken.length} comment(s): ${taken.map((c) => c.id).join(", ")}`
  );
  return true;
}

export async function claim(wait: boolean): Promise<boolean> {
  // A follow-up is looking for what came after, so it never inherits this.
  let already = wait ? undefined : process.env.CLAIMED;
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
  const deadline = Date.now() + (wait ? WINDOW * 1000 : 0);

  while (true) {
    if (await take(cutoff, already)) {
      return true;
    }
    already = undefined;
    if (Date.now() >= deadline) {
      console.error("nothing outstanding");
      return false;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
