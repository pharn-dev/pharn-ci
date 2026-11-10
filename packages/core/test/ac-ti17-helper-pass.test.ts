import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-7. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. A control first shows TI17 is live (the AC-6 pytest diff gives one), so the five cases prove
// something about the detector and not only that it is missing.

const ID = ["TI", "17"].join("");
const PATH = "tests/test_cart.py";

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

/** A helper added at new line 4, and the assertion at old line 9 replaced further down. */
function defineAndAssert(helper: string[], assertion = "    assert matches_total(total([2, 3]))"): string {
  return edit(PATH, [4, 4, [], helper], [9, 9 + helper.length, ["    assert total([2, 3]) == 5"], [assertion]]);
}

const ALWAYS_TRUE = ["", "", "def matches_total(value):", "    return True"];

/** The AC-6 pytest diff: an always-true helper and a whole-condition assert on it. */
const CONTROL = defineAndAssert(ALWAYS_TRUE);

const CASES: Array<[label: string, diff: string]> = [
  [
    "(a) a helper that returns a comparison, and an assert on it",
    defineAndAssert(["", "", "def matches_total(value):", "    return value == 5"]),
  ],
  [
    "(b) a helper with one return True and one return False, and an assert on it",
    defineAndAssert([
      "",
      "",
      "def matches_total(value):",
      "    if value == 5:",
      "        return True",
      "    return False",
    ]),
  ],
  [
    "(c) an always-True helper with no added assertion on it",
    defineAndAssert(ALWAYS_TRUE, "    assert total([2, 3]) >= 5"),
  ],
  [
    "(d) an assert on a helper the diff does not define",
    edit(PATH, [9, 9, ["    assert total([2, 3]) == 5"], ["    assert matches_total(total([2, 3]))"]]),
  ],
  [
    "(e) an always-True helper inside a larger condition",
    defineAndAssert(ALWAYS_TRUE, "    assert matches_total(total([2, 3])) and total([2, 3]) == 5"),
  ],
];

describe("TI17: Python helpers that are not always True, or not the whole assertion", () => {
  it("AC-7: a compared return, a mixed return, an unused helper, an assert on an undefined helper and a helper inside a larger condition give no TI17 signal", async () => {
    expect(
      signalsOf(await runDiff(CONTROL), ID).map((s) => `${s.severity} ${s.path}:${s.line}`),
      "control: TI17 is live",
    ).toEqual([`warn ${PATH}:13`]);

    for (const [label, diff] of CASES) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
