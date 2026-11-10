import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-6. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. The diff alone is given: no test sources and no Python index.

const ID = ["TI", "17"].join("");

type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

/** pytest: a helper with one `return True` (new lines 4 to 7), and the assertion on it at line 13. */
const PYTEST = edit(
  "tests/test_cart.py",
  [4, 4, [], ["", "", "def matches_total(value):", "    return True"]],
  [9, 13, ["    assert total([2, 3]) == 5"], ["    assert matches_total(total([2, 3]))"]],
);

/** unittest: a helper with two `return True` branches (new lines 4 to 9), and assertTrue on it at line 16. */
const UNITTEST = edit(
  "tests/test_cart_unittest.py",
  [4, 4, [], ["", "", "def matches_total(value):", "    if value:", "        return True", "    return True"]],
  [10, 16, ["        self.assertEqual(total([2, 3]), 5)"], ["        self.assertTrue(matches_total(total([2, 3])))"]],
);

describe("TI17: a Python helper that always returns True, asserted on", () => {
  it("AC-6: a pytest assert and a unittest assertTrue on a helper whose every return is True give one TI17 warn signal per file at the line of the first such added assertion, from the diff alone", async () => {
    const signals = signalsOf(await runDiff(PYTEST + UNITTEST), ID);
    expect(signals.map((s) => `${s.severity} ${s.path}:${s.line}`)).toEqual([
      "warn tests/test_cart.py:13",
      "warn tests/test_cart_unittest.py:16",
    ]);
  });
});
