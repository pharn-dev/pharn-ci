import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-10. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. The diff alone is given: no test sources and no Python index.

const ID = ["TI", "17"].join("");
const PATH = "tests/test_cart.py";

/** A one-hunk diff replacing line 10 of the test file. */
function replaceLine(removed: string, added: string): string {
  return [
    `diff --git a/${PATH} b/${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${PATH}`,
    `+++ b/${PATH}`,
    "@@ -10 +10 @@",
    `-${removed}`,
    `+${added}`,
    "",
  ].join("\n");
}

const CASES: Array<[label: string, removed: string, added: string]> = [
  ["== ANY", "    assert total([2, 3]) == 5", "    assert total([2, 3]) == ANY"],
  ["== mock.ANY", "    assert total([2, 3]) == 5", "    assert total([2, 3]) == mock.ANY"],
  ["== unittest.mock.ANY", "    assert total([2, 3]) == 5", "    assert total([2, 3]) == unittest.mock.ANY"],
  [
    "assertEqual(..., ANY) in a unittest.TestCase method",
    "        self.assertEqual(total([2, 3]), 5)",
    "        self.assertEqual(total([2, 3]), ANY)",
  ],
];

describe("TI17: a wildcard in place of a concrete expected value (Python)", () => {
  for (const [label, removed, added] of CASES) {
    it(`AC-10: ${label} in place of 5, in the same hunk, gives one TI17 warn signal at the added line, from the diff alone`, async () => {
      const signals = signalsOf(await runDiff(replaceLine(removed, added)), ID);
      expect(signals.map((s) => `${s.severity} ${s.path}:${s.line}`)).toEqual([`warn ${PATH}:10`]);
    });
  }
});
