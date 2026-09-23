#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// Post everything the run produced, as one review, once.
//
// The sandbox cannot reach GitHub. It leaves line comments in findings.jsonl
// and its reply in finish.json, and this is the only thing that publishes
// either.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "./github.ts";

// Every reply says where it came from and offers a way to say whether it
// helped. Line comments do not carry it: once per review is a footer, on each
// one it is noise.
const FOOTER =
  "<sub>:robot: AI generated response. " +
  "Help us improve with a \u{1F44D} or \u{1F44E} reaction.</sub>";

const temp = process.env.RUNNER_TEMP!;
const repo = process.env.GITHUB_REPOSITORY!;
const issue = process.env.ISSUE_NUMBER!;

// Take any credential back out of what is about to be published. The agent
// holds them so its provider can reach the model, and a reply is the one thing
// it writes that leaves the sandbox. Log masking does not reach a comment.
const secrets = (() => {
  const path = process.env.PROVIDER_ENV_FILE;
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.slice(line.indexOf("=") + 1).trim())
    .filter((value) => value.length > 7);
})();

function redact(text: string): string {
  return secrets.reduce((out, value) => out.replaceAll(value, "[redacted]"), text);
}

function sign(body: string): string {
  const signed = redact(body).trim();
  return signed ? `${signed}\n\n${FOOTER}` : FOOTER;
}

type Finding = { path: string; line: number; side: "RIGHT"; body: string };

function readFindings(path: string): Finding[] {
  const out: Finding[] = [];
  readFileSync(path, "utf8").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let f: Record<string, unknown>;
    try {
      f = JSON.parse(line);
    } catch {
      console.error(`ignoring unreadable line comment on line ${i + 1}`);
      return;
    }
    if (typeof f.path === "string" && typeof f.line === "number" && typeof f.body === "string") {
      out.push({ path: f.path, line: f.line, side: "RIGHT", body: redact(f.body) });
    } else {
      console.error(`ignoring incomplete line comment on line ${i + 1}`);
    }
  });
  return out;
}

const finish = join(temp, "finish.json");
if (!existsSync(finish)) {
  console.error("the agent never finished; nothing to post");
  process.exit(1);
}
const reply = ((JSON.parse(readFileSync(finish, "utf8")).reply as string) ?? "").trim();

const findingsFile = join(temp, "findings.jsonl");
const comments = existsSync(findingsFile) ? readFindings(findingsFile) : [];

// A failure here is the run losing its answer, so it says what happened
// rather than unwinding a stack at whoever reads the log.
try {
  await publish();
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
}

async function publish() {
if (comments.length === 0) {
  if (!reply) {
    console.error("the agent finished with nothing to say");
    process.exit(0);
  }
  await request("POST", `/repos/${repo}/issues/${issue}/comments`, { body: sign(reply) });
} else {
  // A review carries the line comments and the reply together, so the author
  // gets one notification rather than one per point.
  console.error(`posting ${comments.length} line comment(s)`);
  await request("POST", `/repos/${repo}/pulls/${issue}/reviews`, {
    commit_id: readFileSync(join(temp, "relay.pushed"), "utf8").trim(),
    event: "COMMENT",
    body: sign(reply),
    comments,
  });
}
}
