// Take the mentions nobody has answered yet. Reacting is what claims one, so
// two runs cannot answer the same comment.
import { remember } from "./claims.ts";
import { canInstruct, type Comment, listComments, request } from "./github.ts";
import { type Mention } from "./mentions.ts";

const CLAIM = "eyes";
const MACRO = process.env.MENTION!;
// Older than this is a backlog, and a backlog should not be answered at once.
const MAX_AGE_HOURS = Number(process.env.MAX_COMMENT_AGE_HOURS ?? "1");
const WINDOW = Number(process.env.FOLLOWUP_WINDOW ?? "60");

const repo = process.env.GITHUB_REPOSITORY!;
const issue = process.env.ISSUE_NUMBER!;

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
    if (response.status !== 201) {
      return false;
    }
    const reaction = (await response.json()) as { id: number };
    remember(id, reaction.id);
    return true;
  } catch (error) {
    console.error(`could not claim ${id}: ${error}`);
    return false;
  }
}

async function outstanding(
  cutoff: string,
  already?: string
): Promise<Comment[]> {
  // The cutoff keeps a poll every few seconds from reading the whole thread.
  const all = await listComments(repo, issue, cutoff);
  if (already && !all.some((c) => String(c.id) === already)) {
    const response = await request(
      "GET",
      `/repos/${repo}/issues/comments/${already}`
    );
    all.push((await response.json()) as Comment);
  }
  return all
    .filter(
      (c) => !process.env.AGENT_TASK || !already || String(c.id) === already
    )
    .filter((c) => c.created_at >= cutoff || String(c.id) === already)
    .filter(canInstruct)
    .filter(
      (c) =>
        (process.env.AGENT_TASK && String(c.id) === already) ||
        (c.body ?? "").includes(MACRO)
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function take(
  cutoff: string,
  already: string | undefined
): Promise<Mention[]> {
  const taken = [];
  for (const c of await outstanding(cutoff, already)) {
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
  if (taken.length === 0) {
    return [];
  }

  console.error(
    `answering ${taken.length} comment(s): ${taken.map((c) => c.id).join(", ")}`
  );
  return taken;
}

export async function claim(wait: boolean): Promise<Mention[]> {
  // A follow-up is looking for what came after, so it never inherits this.
  let already = wait ? undefined : process.env.CLAIMED;
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
  const deadline = Date.now() + (wait ? WINDOW * 1000 : 0);

  while (true) {
    const taken = await take(cutoff, already);
    if (taken.length) {
      return taken;
    }
    already = undefined;
    if (Date.now() >= deadline) {
      console.error("nothing outstanding");
      return [];
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
