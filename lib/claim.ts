// Take the mentions nobody has answered yet. Reacting is what claims one, so
// two runs cannot answer the same comment.
import { remember } from "./claims.ts";
import {
  type Comment,
  listComments,
  listReviewComments,
  request,
  TRUSTED,
} from "./github.ts";
import { type Mention } from "./mentions.ts";
import { reviewThread } from "./review-thread.ts";

const CLAIM = "eyes";
const MACRO = process.env.MENTION!;
// Older than this is a backlog, and a backlog should not be answered at once.
const MAX_AGE_HOURS = Number(process.env.MAX_COMMENT_AGE_HOURS ?? "1");
const WINDOW = Number(process.env.FOLLOWUP_WINDOW ?? "120");

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
  comment: Comment,
  already: string | undefined
): Promise<boolean> {
  const { id } = comment;
  const kind = comment.kind ?? "issues";
  if (
    already !== undefined &&
    String(id) === already &&
    kind === (process.env.COMMENT_KIND ?? "issues")
  ) {
    return true;
  }

  try {
    const response = await request(
      "POST",
      `/repos/${repo}/${kind}/comments/${id}/reactions`,
      {
        content: CLAIM,
      }
    );
    if (response.status !== 201) {
      return false;
    }
    const reaction = (await response.json()) as { id: number };
    remember(id, reaction.id, kind);
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
  if (process.env.IS_PULL_REQUEST === "yes") {
    all.push(...(await listReviewComments(repo, issue, cutoff)));
  }
  const kind = process.env.COMMENT_KIND ?? "issues";
  const isTrigger = (c: Comment) =>
    String(c.id) === already && (c.kind ?? "issues") === kind;
  if (already && !all.some(isTrigger)) {
    const response = await request(
      "GET",
      `/repos/${repo}/${kind}/comments/${already}`
    );
    all.push({
      ...((await response.json()) as Comment),
      kind: kind as "issues" | "pulls",
    });
  }
  return all
    .filter((c) => c.created_at >= cutoff || isTrigger(c))
    .filter((c) => !c.user.login.endsWith("[bot]"))
    .filter((c) => TRUSTED.has(c.author_association))
    .filter((c) => (c.body ?? "").includes(MACRO))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function take(
  cutoff: string,
  already: string | undefined
): Promise<Mention[]> {
  const taken = [];
  for (const c of await outstanding(cutoff, already)) {
    if (!(await react(c, already))) {
      continue;
    }
    taken.push({
      id: c.id,
      author: c.user.login,
      body: c.body,
      created_at: c.created_at,
      ...(c.kind === "pulls" ? await reviewThread(repo, issue, c) : {}),
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
