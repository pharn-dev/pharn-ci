import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI16 exists, so nothing
// the build adds may run while the file loads.

/** The signal id, the comment openers and every marker, built from parts so this file holds none as written. */
const ID = ["TI", "16"].join("");
const j = (...parts: string[]) => parts.join("");
const LINE = j("/", "/");
const OPEN = j("/", "*");
const CLOSE = j("*", "/");
const ESLINT = j("eslint", "-disable");
const NEXT_LINE = `${ESLINT}-next-line`;
const TYPE_IGNORE = j("type", ": ignore");
const NOQA = j("no", "qa");

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
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

const add = (path: string, lines: string[]) => edit(path, [12, 12, [], lines]);

const JS_COMMENTS = [
  `  ${LINE} ${NEXT_LINE} no-console`,
  `${OPEN} ${ESLINT} ${CLOSE}`,
  `  ${LINE} ${j("@ts", "-ignore")}`,
  `  ${LINE} ${j("@ts", "-expect-error")}`,
  `  ${LINE} ${j("biome", "-ignore")} lint/style: x`,
  `  ${LINE} ${j("oxlint", "-disable-next-line")}`,
];
const PY_COMMENTS = [
  `x = load()  # ${TYPE_IGNORE}[attr-defined]`,
  `import os  # ${NOQA}: E501`,
  `import sys  # ${j("pylint", ": disable")}=unused-import`,
  `y = bar()  # ${j("pyright", ": ignore")}`,
];

/** Control: one suppression added to a test file gives a TI16 signal. */
const CONTROL = add("src/a.test.ts", [JS_COMMENTS[0] as string]);

const CASES: Array<[label: string, diff: string]> = [
  ["the comments added to the non-test source file src/a.ts", add("src/a.ts", JS_COMMENTS)],
  ["the Python comments added to the non-test source file src/a.py", add("src/a.py", PY_COMMENTS)],
  [
    "a suppression line removed and added unchanged in a test file",
    edit("src/a.test.ts", [5, 5, [JS_COMMENTS[0] as string], []], [20, 19, [], [JS_COMMENTS[0] as string]]),
  ],
  [
    "the same suppression moved with different spacing",
    edit(
      "src/a.test.ts",
      [5, 5, [`  ${LINE} ${NEXT_LINE}   no-console`], []],
      [20, 19, [], [`      ${LINE}   ${NEXT_LINE} no-console`]],
    ),
  ],
  [
    "a Python suppression moved within a test file",
    edit("tests/test_x.py", [4, 4, [PY_COMMENTS[1] as string], []], [9, 8, [], [PY_COMMENTS[1] as string]]),
  ],
  ["an ESLint disable added to the Go test file x_test.go", add("x_test.go", [`${LINE} ${ESLINT}`])],
  ["the marker word in a string with no comment opener", add("src/a.test.ts", [`const note = "${ESLINT}";`])],
  ["a Python marker in a string with no #", add("tests/test_x.py", [`msg = "${TYPE_IGNORE}"`])],
  ["# noqa added to a TypeScript test file", add("src/a.test.ts", [`const a = 1; # ${NOQA}`])],
];

describe("TI16: edits that add no fresh suppression to a test file", () => {
  it("AC-11: markers in non-test files, unchanged or respaced moves, Go test files, marker words without a comment opener and the other language's marker give no TI16", async () => {
    const control = signalsOf(await runDiff(CONTROL), ID);
    expect(control.map((s) => `${s.severity} ${s.path}:${s.line}`)).toEqual(["info src/a.test.ts:12"]);

    for (const [label, diff] of CASES) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
