import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-11. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. A control first shows TI17 is live (an AC-10 diff gives one), so the five cases prove something
// about the detector and not only that it is missing.

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

const replace = (removed: string, added: string) => edit(PATH, [10, 10, [removed], [added]]);

/** An AC-10 diff: == 5 becomes == ANY. */
const CONTROL = replace("    assert total([2, 3]) == 5", "    assert total([2, 3]) == ANY");

const CASES: Array<[label: string, diff: string]> = [
  [
    "(a) ANY as one argument of assert_called_with",
    replace("    m.assert_called_with(1, 2)", "    m.assert_called_with(1, ANY)"),
  ],
  [
    "(b) mock.ANY as the argument of assert_called_once_with",
    replace("    m.assert_called_once_with(2)", "    m.assert_called_once_with(mock.ANY)"),
  ],
  [
    "(c) ANY nested inside a larger expected value",
    replace('    assert row == {"id": 7, "total": 5}', '    assert row == {"id": ANY, "total": 5}'),
  ],
  [
    "(d) a new test whose assertion is == ANY, while the change removes no line",
    edit(PATH, [20, 20, [], ["", "", "def test_makes_something():", "    assert make() == ANY"]]),
  ],
  ["(e) a line that already read assert x == ANY, re-indented", replace("  assert x == ANY", "    assert x == ANY")],
];

describe("TI17: wildcards that replace no concrete expected value (Python)", () => {
  it("AC-11: ANY in a call assertion's arguments, a nested ANY, == ANY in a new test and a re-indented == ANY line give no TI17 signal", async () => {
    expect(
      signalsOf(await runDiff(CONTROL), ID).map((s) => `${s.severity} ${s.path}:${s.line}`),
      "control: TI17 is live",
    ).toEqual([`warn ${PATH}:10`]);

    for (const [label, diff] of CASES) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
