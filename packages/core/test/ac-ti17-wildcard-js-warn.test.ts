import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-8. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. The diff alone is given. The wildcard is built from parts, so this file holds none as written.

const ID = ["TI", "17"].join("");
const ANYTHING = ["expect", "anything()"].join(".");
const PATH = "src/cart.test.ts";

/** A one-hunk diff replacing line 9 of the test file. */
function replaceLine(removed: string, added: string): string {
  return [
    `diff --git a/${PATH} b/${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${PATH}`,
    `+++ b/${PATH}`,
    "@@ -9 +9 @@",
    `-${removed}`,
    `+${added}`,
    "",
  ].join("\n");
}

describe("TI17: a wildcard in place of a concrete expected value (JS/TS)", () => {
  for (const matcher of ["toBe", "toEqual", "toStrictEqual"]) {
    it(`AC-8: ${matcher}(5) replaced by ${matcher}(expect.anything()) in the same hunk gives one TI17 warn signal at the added line, from the diff alone`, async () => {
      const diff = replaceLine(
        `    expect(total([2, 3])).${matcher}(5);`,
        `    expect(total([2, 3])).${matcher}(${ANYTHING});`,
      );
      const signals = signalsOf(await runDiff(diff), ID);
      expect(signals.map((s) => `${s.severity} ${s.path}:${s.line}`)).toEqual([`warn ${PATH}:9`]);
    });
  }
});
