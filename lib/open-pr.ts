import { allowed, type BranchPolicy } from "./branches.ts";
import { request } from "./github.ts";

export async function openPullRequest(
  rules: BranchPolicy,
  repo: string,
  input: unknown
): Promise<unknown> {
  if (!input || typeof input !== "object") {
    throw new Error("Expected head, base, title and body");
  }
  const { head, base, title, body } = input as Record<string, unknown>;
  for (const [name, value] of Object.entries({ head, base, title, body })) {
    if (typeof value !== "string" || (name !== "body" && !value.trim())) {
      throw new Error(`${name} must be a string`);
    }
  }
  if (!allowed(rules, head as string)) {
    throw new Error("PR head branch is not allowed");
  }
  if (head === base) {
    throw new Error("PR head and base must differ");
  }
  const prefix = `/repos/${repo}`;
  // Resolve both branches in this repository; fork-qualified heads are not accepted.
  for (const branch of [head, base]) {
    await request(
      "GET",
      `${prefix}/branches/${encodeURIComponent(branch as string)}`
    );
  }
  const query = new URLSearchParams({
    head: `${repo.split("/")[0]}:${head}`,
    base: base as string,
    state: "open",
  });
  const existing = (await (
    await request("GET", `${prefix}/pulls?${query}`)
  ).json()) as { html_url: string }[];
  if (existing.length) {
    return { url: existing[0]!.html_url, created: false };
  }
  const pr = (await (
    await request("POST", `${prefix}/pulls`, { head, base, title, body })
  ).json()) as { html_url: string };
  return { url: pr.html_url, created: true };
}
