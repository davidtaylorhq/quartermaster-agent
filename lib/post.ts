// Publish everything a turn produced, as one review, once. The sandbox holds
// no GitHub credential, so it leaves its reply and line comments here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "./github.ts";

// On the reply only: on every line comment it would be noise.
const FOOTER =
  "<sub>:robot: AI generated response - help improve with \u{1F44D} or \u{1F44E}</sub>";

const temp = process.env.RUNNER_TEMP!;
const repo = process.env.GITHUB_REPOSITORY!;
const issue = process.env.ISSUE_NUMBER!;

function sign(body: string): string {
  const signed = body.trim();
  return signed ? `${signed}\n\n${FOOTER}` : FOOTER;
}

type Finding = { path: string; line: number; side: "RIGHT"; body: string };

function readFindings(path: string): Finding[] {
  const out: Finding[] = [];
  readFileSync(path, "utf8").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let f: Record<string, unknown> | null;
    try {
      f = JSON.parse(line);
    } catch {
      console.error(`ignoring unreadable line comment on line ${i + 1}`);
      return;
    }
    if (f !== null && typeof f.path === "string" && typeof f.line === "number" && typeof f.body === "string") {
      out.push({ path: f.path, line: f.line, side: "RIGHT", body: f.body });
    } else {
      console.error(`ignoring incomplete line comment on line ${i + 1}`);
    }
  });
  return out;
}

export async function publish(): Promise<void> {
  const finish = join(temp, "finish.json");
  if (!existsSync(finish)) {
    console.error("the agent never finished; nothing to post");
    throw new Error("nothing to post");
  }
  const reply = ((JSON.parse(readFileSync(finish, "utf8")).reply as string) ?? "").trim();

  const findingsFile = join(temp, "findings.jsonl");
  const comments = existsSync(findingsFile) ? readFindings(findingsFile) : [];

  // Only a pull request has a diff to hang them on.
  if (comments.length > 0 && process.env.IS_PULL_REQUEST === "yes") {
    // One review, so the author gets one notification rather than one per point.
    console.error(`posting ${comments.length} line comment(s)`);
    try {
      await request("POST", `/repos/${repo}/pulls/${issue}/reviews`, {
        commit_id: readFileSync(join(temp, "relay.pushed"), "utf8").trim(),
        event: "COMMENT",
        body: sign(reply),
        comments,
      });
      return;
    } catch (error) {
      // GitHub takes a review whole or not at all, and one line outside the
      // diff loses the reply with it.
      console.error(`the review was refused, so the reply carries its points: ${error}`);
    }
  }

  if (!reply && comments.length === 0) {
    console.error("the agent finished with nothing to say");
    return;
  }
  await comment(repo, issue, [reply, ...comments.map(asText)].filter(Boolean).join("\n\n"));
}

function asText(f: Finding): string {
  return `**\`${f.path}\`** line ${f.line}\n\n${f.body}`;
}

async function comment(repo: string, issue: string, body: string): Promise<void> {
  await request("POST", `/repos/${repo}/issues/${issue}/comments`, { body: sign(body) });
}
