// The comments this turn is answering.
import { readFileSync } from "node:fs";

export type Mention = { id: number; author: string; body: string };

export function waiting(): Mention[] {
  return JSON.parse(readFileSync(process.env.MENTION_FILE!, "utf8")) as Mention[];
}

export function render(mentions: Mention[]): string {
  const out = mentions.length > 1
    ? [`${mentions.length} comments are waiting. Where they disagree, the last one wins.`, ""]
    : [];

  for (const m of mentions) out.push(`@${m.author}:`, m.body.trim(), "");
  return out.join("\n");
}
