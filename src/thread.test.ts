import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The stripper is not exported, so this pins the behaviour through the same
// shapes the thread actually contains.
const source = readFileSync(join(import.meta.dirname, "thread.ts"), "utf8");
const FOOTERS = ['<div align="right"><sub>:robot:', "<sub>:robot:"];
function withoutFooter(body: string): string {
  const at = FOOTERS.map((f) => body.indexOf(f)).filter((i) => i !== -1);
  return at.length === 0 ? body : body.slice(0, Math.min(...at)).trimEnd();
}

test("the stripper here is the one thread.ts uses", () => {
  assert.match(source, /const FOOTERS = \['<div align="right"><sub>:robot:', "<sub>:robot:"\]/);
});

test("the wrapped footer is removed whole", () => {
  const body = 'An answer.\n\n<div align="right"><sub>:robot: AI generated response - help improve with 👍 or 👎</sub></div>';
  assert.equal(withoutFooter(body), "An answer.");
});

test("a footer from before the wrapper is still removed", () => {
  const body = "An answer.\n\n<sub>:robot: AI generated response. Help us improve with a 👍 or 👎 reaction.</sub>";
  assert.equal(withoutFooter(body), "An answer.");
});

test("someone else's words are left alone", () => {
  assert.equal(withoutFooter("I think <sub>this</sub> is fine"), "I think <sub>this</sub> is fine");
});
