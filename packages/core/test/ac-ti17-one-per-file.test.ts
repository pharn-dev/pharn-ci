import { describe, expect, it } from "vitest";
import { messagesOf, runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-13. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. The matcher opener and the wildcard are built from parts, so this file holds none as written.
// The matcher and helper names are unusual on purpose, so that finding them in a detail can only mean it was copied
// from the diff.

const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");
const EXTEND = ["expect", "extend({"].join(".");
const ANYTHING = ["expect", "anything()"].join(".");
const MATCHER_NAME = "toBeQuuxTotal";
const HELPER_NAME = "quux_helper";

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

/**
 * src/a.test.ts: the matcher at new lines 4 to 6, a wildcard replacement at line 9 (the lowest always-true assertion)
 * and three assertions that call the matcher at lines 12, 15 and 18: four always-true assertions.
 */
const A_HUNKS: Hunk[] = [
  [4, 4, [], [EXTEND, `  ${MATCHER_NAME}: () => ({ pass: true, message: () => "" }),`, "});"]],
  [6, 9, ["    expect(make()).toBe(7);"], [`    expect(make()).toBe(${ANYTHING});`]],
  [9, 12, ["    expect(total([2, 3])).toBe(5);"], [`    expect(total([2, 3])).${MATCHER_NAME}();`]],
  [12, 15, ["    expect(total([1])).toBe(1);"], [`    expect(total([1])).${MATCHER_NAME}();`]],
  [15, 18, ["    expect(total([])).toBe(0);"], [`    expect(total([])).${MATCHER_NAME}();`]],
];

/** tests/test_b.py: the helper at new lines 4 to 7, the one assertion on it at line 13. */
const B_HUNKS: Hunk[] = [
  [4, 4, [], ["", "", `def ${HELPER_NAME}(value):`, "    return True"]],
  [9, 13, ["    assert total([2, 3]) == 5"], [`    assert ${HELPER_NAME}(total([2, 3]))`]],
];

const DIFF = edit("src/a.test.ts", ...A_HUNKS) + edit("tests/test_b.py", ...B_HUNKS);

/** Every added line of the diff, trimmed: none of it may appear in a detail. */
const ADDED_TEXT = [...A_HUNKS, ...B_HUNKS]
  .flatMap(([, , , added]) => added)
  .map((line) => line.trim())
  .filter((line) => line.length > 3);

describe("TI17: one finding per test file", () => {
  it("AC-13: four always-true assertions in one test file and one in another give exactly one TI17 signal per file, at the lowest such line, ordered by path, with a short fixed detail that counts them and holds no text of the diff; the one TEST_INTEGRITY_TI17 message names both paths", async () => {
    const report = await runDiff(DIFF);
    const signals = signalsOf(report, ID);
    expect(signals.map((s) => `${s.severity} ${s.path}:${s.line}`)).toEqual([
      "warn src/a.test.ts:9",
      "warn tests/test_b.py:13",
    ]);

    const counts = [4, 1];
    signals.forEach((signal, at) => {
      const detail = signal.detail;
      expect(detail.length, `${signal.path}: detail length`).toBeLessThanOrEqual(300);
      expect(detail, `${signal.path}: the detail says how many`).toMatch(new RegExp(`\\b${counts[at]}\\b`));
      for (const name of [MATCHER_NAME, HELPER_NAME, "Quux", "quux", ANYTHING, "expect(", "assert "]) {
        expect(detail, `${signal.path}: the detail holds no ${name}`).not.toContain(name);
      }
      for (const line of ADDED_TEXT)
        expect(detail, `${signal.path}: the detail holds no added line`).not.toContain(line);
    });

    const messages = messagesOf(report, CODE);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain("src/a.test.ts");
    expect(messages[0]?.text).toContain("tests/test_b.py");
  });
});
