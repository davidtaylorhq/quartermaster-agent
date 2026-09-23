import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutFooter } from "../lib/thread.ts";

test("our signature is trimmed off", () => {
  const body =
    'An answer.\n\n<div align="right"><sub>:robot: AI generated response - help improve with 👍 or 👎</sub></div>';
  assert.equal(withoutFooter(body), "An answer.");
});

test("the form used before the wrapper is trimmed too", () => {
  const body =
    "An answer.\n\n<sub>:robot: AI generated response. Help us improve with a 👍 or 👎 reaction.</sub>";
  assert.equal(withoutFooter(body), "An answer.");
});

test("someone else's markup is left alone", () => {
  assert.equal(
    withoutFooter("I think <sub>this</sub> is fine"),
    "I think <sub>this</sub> is fine"
  );
});
