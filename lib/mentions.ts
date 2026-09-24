export type Mention = { id: number; author: string; body: string };

export function render(mentions: Mention[]): string {
  const out =
    mentions.length > 1
      ? [
          `${mentions.length} comments are waiting. Where they disagree, the last one wins.`,
          "",
        ]
      : [];

  for (const m of mentions) {
    out.push(`@${m.author}:`, m.body.trim(), "");
  }
  return out.join("\n");
}
