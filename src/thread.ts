// Print what has already been said on this issue.
//
// The agent has no memory between mentions, so the thread goes in the prompt.
import { listComments, TRUSTED, type Comment } from "./github.ts";

const KEEP = 20;
const WIDTH = 800;

// Our own bookkeeping is not conversation.
const NOISE = ["Superseded by a newer mention.", "The run failed.", "Starting…", "On it!"];
// Both spellings appear in a thread; trimming at the inner one strands the
// outer tag.
const FOOTERS = ['<div align="right"><sub>:robot:', "<sub>:robot:"];

export function withoutFooter(body: string): string {
  const at = FOOTERS.map((f) => body.indexOf(f)).filter((i) => i !== -1);
  return at.length === 0 ? body : body.slice(0, Math.min(...at)).trimEnd();
}

function useful(c: Comment): boolean {
  const body = (c.body ?? "").trim();
  return body !== "" && !NOISE.some((n) => body.startsWith(n));
}

export async function thread(skip: Set<string>): Promise<string> {
  const all = await listComments(
    process.env.GITHUB_REPOSITORY!,
    process.env.ISSUE_NUMBER!,
  );
  let kept = all.filter((c) => useful(c) && !skip.has(String(c.id)));
  if (kept.length === 0) return "";

  const out: string[] = [];
  const dropped = kept.length - KEEP;
  if (dropped > 0) {
    out.push(`(${dropped} earlier comment(s) not shown; read them if you need them)`, "");
    kept = kept.slice(-KEEP);
  }

  for (const c of kept) {
    let body = withoutFooter(c.body.trim());
    if (body.length > WIDTH) body = body.slice(0, WIDTH) + " […]";

    let who: string = c.user.login;
    if (who === (process.env.BOT_LOGIN ?? "github-actions[bot]")) {
      who = "you";
    } else if (!TRUSTED.has(c.author_association)) {
      who = `${who} (cannot write to this repository)`;
    }
    out.push(`@${who}:`, body, "");
  }
  return out.join("\n");
}
