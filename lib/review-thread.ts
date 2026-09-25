import { type Comment, listReviewComments } from "./github.ts";

export async function reviewThread(
  repo: string,
  issue: string,
  comment: Comment
) {
  const replyTo = comment.in_reply_to_id ?? comment.id;
  const all = await listReviewComments(repo, issue);
  const root = all.find((c) => c.id === replyTo);
  if (!root) {
    throw new Error(`Review thread ${replyTo} is no longer available`);
  }
  const earlier = all
    .filter(
      (c) =>
        (c.id === replyTo || c.in_reply_to_id === replyTo) &&
        c.id !== comment.id &&
        c.created_at <= comment.created_at
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const context = [
    `${root.html_url}: ${root.path}, line ${root.line ?? root.original_line} (check the current diff if outdated)`,
    root.diff_hunk ?? "",
    ...earlier.map((c) => `@${c.user.login}:\n${c.body}`),
  ].join("\n\n");
  return { replyTo, context };
}
