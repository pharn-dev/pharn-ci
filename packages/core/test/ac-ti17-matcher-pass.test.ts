import { describe, expect, it } from "vitest";
import { messagesOf, runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";

// ti17-always-true-matcher-2, AC-5. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. A control first shows TI17 is live (the vitest Skylos diff gives one), so the five cases prove
// something about the detector and not only that it is missing. The matcher opener is built from parts, so this file
// holds none as written.

const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");
const EXTEND = ["expect", "extend({"].join(".");
const PATH = "src/cart.test.ts";

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

/** A definition added at new line 4 and the assertion changed to call the matcher further down. */
function defineAndCall(definition: string[], call = "    expect(total([2, 3])).toBeTotal();"): string {
  const at = 4 + definition.length + 6;
  return edit(PATH, [4, 4, [], definition], [10, at, ["    expect(total([2, 3])).toBe(5);"], [call]]);
}

const CASES: Array<[label: string, diff: string]> = [
  [
    "(a) a matcher whose pass compares its argument, and a call to it",
    defineAndCall([`${EXTEND} toBeTotal: (received) => ({ pass: received === 5, message: () => "" }) });`]),
  ],
  [
    "(b) a matcher with one pass: true and one pass: false, and a call to it",
    defineAndCall([
      `${EXTEND}`,
      "  toBeTotal(received) {",
      `    if (received === 5) return { pass: true, message: () => "" };`,
      `    return { pass: false, message: () => "" };`,
      "  },",
      "});",
    ]),
  ],
  [
    "(c) a matcher with pass: true that no added line calls",
    defineAndCall(
      [`${EXTEND} toBeTotal: () => ({ pass: true, message: () => "" }) });`],
      "    expect(total([2, 3])).toEqual(5);",
    ),
  ],
  [
    "(d) a call to a matcher the diff does not define",
    edit(PATH, [9, 9, ["    expect(total([2, 3])).toBe(5);"], ["    expect(total([2, 3])).toBeTotal();"]]),
  ],
  [
    "(e) a matcher whose pass is a variable, and a call to it",
    defineAndCall(["const ok = true;", `${EXTEND} toBeTotal: () => ({ pass: ok, message: () => "" }) });`]),
  ],
];

describe("TI17: matchers that are not always true, or not used", () => {
  it("AC-5: a compared pass, a mixed pass, an uncalled matcher, a call to an undefined matcher and a pass read from a variable give no TI17 signal and no TEST_INTEGRITY_TI17 message", async () => {
    const control = await runDiff(fixture("skylos-nine/always-true-matcher/change.diff"));
    expect(
      signalsOf(control, ID).map((s) => `${s.severity} ${s.path}:${s.line}`),
      "control: TI17 is live",
    ).toEqual(["warn src/cart.test.ts:9"]);

    for (const [label, diff] of CASES) {
      const report = await runDiff(diff);
      expect(signalsOf(report, ID), label).toEqual([]);
      expect(messagesOf(report, CODE), label).toEqual([]);
    }
  });
});
