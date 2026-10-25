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

const JS_COMMENTS = [
  `  ${LINE} ${ESLINT}-next-line no-console`,
  `${OPEN} ${ESLINT} ${CLOSE}`,
  `  console.log(x); ${LINE} ${ESLINT}-line`,
  `  ${LINE} ${j("@ts", "-ignore")}`,
  `  ${LINE} ${j("@ts", "-expect-error")}`,
  `${LINE} ${j("@ts", "-nocheck")}`,
  `  ${LINE} ${j("biome", "-ignore")} lint/style: x`,
  `  ${LINE} ${j("oxlint", "-disable-next-line")}`,
];

const PY_COMMENTS = [
  `x = load()  # ${j("type", ": ignore")}[attr-defined]`,
  `import os  # ${j("no", "qa")}: E501`,
  `import sys  # ${j("pylint", ": disable")}=unused-import`,
  `y = bar()  # ${j("pyright", ": ignore")}`,
];

type Case = { label: string; diff: string; path: string; line: number; count: number };

const CASES: Case[] = [
  ...JS_COMMENTS.map((comment, i) => ({
    label: `one comment: ${comment.trim()}`,
    diff: edit(i % 2 === 0 ? "src/a.test.ts" : "tests/x.spec.ts", [12, 12, [], [comment]]),
    path: i % 2 === 0 ? "src/a.test.ts" : "tests/x.spec.ts",
    line: 12,
    count: 1,
  })),
  {
    label: "one test file adding three of them",
    diff: edit(
      "src/three.test.ts",
      [5, 5, [], [JS_COMMENTS[3] as string]],
      [9, 9, [], [JS_COMMENTS[0] as string]],
      [14, 14, [], [JS_COMMENTS[6] as string]],
    ),
    path: "src/three.test.ts",
    line: 5,
    count: 3,
  },
  {
    label: "no-console turned into no-alert",
    diff: edit("src/edit.test.ts", [
      7,
      7,
      [`  ${LINE} ${ESLINT}-next-line no-console`],
      [`  ${LINE} ${ESLINT}-next-line no-alert`],
    ]),
    path: "src/edit.test.ts",
    line: 7,
    count: 1,
  },
  {
    label: "a Python test file adding the four Python markers",
    diff: edit(
      "tests/test_x.py",
      [3, 3, [], [PY_COMMENTS[0] as string]],
      [6, 6, [], [PY_COMMENTS[1] as string]],
      [8, 8, [], [PY_COMMENTS[2] as string]],
      [11, 11, [], [PY_COMMENTS[3] as string]],
    ),
    path: "tests/test_x.py",
    line: 3,
    count: 4,
  },
];

/** Comment text that must not reach a TI16 detail. */
const FORBIDDEN = [
  "eslint",
  "@ts",
  "ts-ignore",
  "expect-error",
  "nocheck",
  "biome",
  "oxlint",
  "noqa",
  "pylint",
  "pyright",
  "type: ignore",
  "no-console",
  "no-alert",
  "lint/style",
  "E501",
  "attr-defined",
  "unused-import",
  LINE,
  OPEN,
];

describe("TI16: lint or type suppression comments added to test files", () => {
  it("AC-10: each JS/TS or Python test file gives one info signal at its first fresh suppression, whose detail names the count and holds no comment text", async () => {
    for (const c of CASES) {
      const signals = signalsOf(await runDiff(c.diff, "block"), ID);
      expect(
        signals.map((s) => `${s.severity} ${s.path}:${s.line}`),
        c.label,
      ).toEqual([`info ${c.path}:${c.line}`]);
      const detail = signals[0]?.detail ?? "";
      expect(detail.length, c.label).toBeGreaterThan(0);
      expect(detail.length, c.label).toBeLessThanOrEqual(300);
      expect(detail, c.label).toMatch(new RegExp(`\\b${c.count}\\b`));
      for (const word of FORBIDDEN)
        expect(detail.toLowerCase(), `${c.label}: "${word}"`).not.toContain(word.toLowerCase());
    }
  });
});
