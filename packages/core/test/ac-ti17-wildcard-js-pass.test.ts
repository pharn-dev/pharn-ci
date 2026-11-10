import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-9. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. A control first shows TI17 is live (an AC-8 diff gives one), so the four cases prove something
// about the detector and not only that it is missing. The wildcard is built from parts, so this file holds none as
// written.

const ID = ["TI", "17"].join("");
const ANYTHING = ["expect", "anything()"].join(".");
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

const replace = (removed: string, added: string) => edit(PATH, [9, 9, [removed], [added]]);

/** An AC-8 diff: toBe(5) becomes toBe(expect.anything()). */
const CONTROL = replace("    expect(total([2, 3])).toBe(5);", `    expect(total([2, 3])).toBe(${ANYTHING});`);

const CASES: Array<[label: string, diff: string]> = [
  [
    "(a) the wildcard stands for one argument of a call matcher",
    replace("    expect(spy).toHaveBeenCalledWith(1, 2);", `    expect(spy).toHaveBeenCalledWith(1, ${ANYTHING});`),
  ],
  [
    "(b) the wildcard is nested inside a larger expected value",
    replace(
      "    expect(order()).toEqual({ id: 7, total: 5 });",
      `    expect(order()).toEqual({ id: ${ANYTHING}, total: 5 });`,
    ),
  ],
  [
    "(c) a new test whose assertion is the wildcard, while the change removes no line",
    edit(PATH, [20, 20, [], ['  it("makes something", () => {', `    expect(make()).toEqual(${ANYTHING});`, "  });"]]),
  ],
  [
    "(d) a line that already read toEqual(expect.anything()), re-indented",
    replace(`  expect(make()).toEqual(${ANYTHING});`, `    expect(make()).toEqual(${ANYTHING});`),
  ],
];

describe("TI17: wildcards that replace no concrete expected value (JS/TS)", () => {
  it("AC-9: a wildcard argument of a call matcher, a nested wildcard, a wildcard in a new test and a re-indented wildcard line give no TI17 signal", async () => {
    expect(
      signalsOf(await runDiff(CONTROL), ID).map((s) => `${s.severity} ${s.path}:${s.line}`),
      "control: TI17 is live",
    ).toEqual([`warn ${PATH}:9`]);

    for (const [label, diff] of CASES) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
