import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-12. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. A control first shows that the same lines in test files give TI17, so the cases prove something
// about the file filter and not only that the detector is missing. The matcher opener is built from parts, so this
// file holds none as written.

const ID = ["TI", "17"].join("");
const EXTEND = ["expect", "extend({"].join(".");

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

const MATCHER = `${EXTEND} toBeTotal: () => ({ pass: true, message: () => "" }) });`;
const MATCHER_CALL_REMOVED = "    expect(total([2, 3])).toBe(5);";
const MATCHER_CALL = "    expect(total([2, 3])).toBeTotal();";

/** The AC-1 lines: the arrow matcher at line 4, the assertion changed to call it at line 9. */
const matcherLines = (path: string) =>
  edit(path, [4, 4, [], [MATCHER]], [8, 9, [MATCHER_CALL_REMOVED], [MATCHER_CALL]]);

/** The AC-6 lines: a helper that returns True at lines 4 to 7, the assertion on it at line 13. */
const helperLines = (path: string) =>
  edit(
    path,
    [4, 4, [], ["", "", "def matches_total(value):", "    return True"]],
    [9, 13, ["    assert total([2, 3]) == 5"], ["    assert matches_total(total([2, 3]))"]],
  );

/** The AC-10 lines: == 5 replaced by == ANY in one hunk at line 10. */
const wildcardLines = (path: string) =>
  edit(path, [10, 10, ["    assert total([2, 3]) == 5"], ["    assert total([2, 3]) == ANY"]]);

const CASES: Array<[label: string, diff: string]> = [
  ["the AC-1 matcher lines in the source file src/matchers.ts", matcherLines("src/matchers.ts")],
  ["the AC-6 helper lines in the source file src/helpers.py", helperLines("src/helpers.py")],
  ["the AC-10 wildcard lines in the source file src/helpers.py", wildcardLines("src/helpers.py")],
  ["the AC-10 added and removed lines in the Go test file pkg/cart_test.go", wildcardLines("pkg/cart_test.go")],
  [
    "a diff that only removes an always-true matcher and its call from a test file",
    edit("src/cart.test.ts", [4, 4, [MATCHER], []], [9, 8, [MATCHER_CALL], []]),
  ],
];

describe("TI17: lines outside JS/TS and Python test files, and removed lines", () => {
  it("AC-12: the always-true lines in non-test files, the wildcard lines in a Go test file and a diff that only removes an always-true matcher give no TI17 signal", async () => {
    const control =
      matcherLines("src/cart.test.ts") + helperLines("tests/test_cart.py") + wildcardLines("tests/test_x.py");
    expect(
      signalsOf(await runDiff(control), ID).map((s) => `${s.severity} ${s.path}:${s.line}`),
      "control: the same lines in test files give TI17",
    ).toEqual(["warn src/cart.test.ts:9", "warn tests/test_cart.py:13", "warn tests/test_x.py:10"]);

    for (const [label, diff] of CASES) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
