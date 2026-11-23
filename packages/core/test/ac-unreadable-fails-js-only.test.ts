import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { PythonTestIndex } from "../src/testIndex/pythonSides.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a reported python-not-found index
// with a modified `.py` test file becomes the whole-run form, so nothing the build changes may run while the file
// loads. A JS-only change keeps today's report with or without that index; the same change plus a modified `.py` test
// file is the control, in the same test, that fails before the build.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const JS_PATH = "src/cart.test.ts";
const PY_PATH = "tests/test_c.py";

const JS_BASE = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
].join("\n");
const JS_HEAD = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "  expect(total([1])).toBe(1);",
  "});",
  "",
].join("\n");
const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

const JS_DIFF = `${[
  `diff --git a/${JS_PATH} b/${JS_PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${JS_PATH}`,
  `+++ b/${JS_PATH}`,
  "@@ -5,0 +6 @@",
  "+  expect(total([1])).toBe(1);",
].join("\n")}\n`;
const PY_DIFF = `${[
  `diff --git a/${PY_PATH} b/${PY_PATH}`,
  "index 3333333..4444444 100644",
  `--- a/${PY_PATH}`,
  `+++ b/${PY_PATH}`,
  "@@ -6,4 +5,0 @@",
  "-",
  "-",
  "-def test_empty():",
  "-    assert total([]) == 0",
].join("\n")}\n`;
const NOT_FOUND: PythonTestIndex = { available: false, reason: "python-not-found" };

/** The check() fields a case sets: the diff, and any field it overrides. */
type CheckFields = Pick<TextCheckInput, "diff"> & Partial<TextCheckInput>;

async function run(input: CheckFields): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [JS_PATH, "src/cart.ts", PY_PATH],
    testIntegrityMode: { input: "block" },
    ...input,
  });
  expectValidReport(report);
  return report;
}

describe("CORE-69: a JS-only change on a runner without python3 keeps today's report", () => {
  it("AC-13: a diff that modifies only src/cart.test.ts gives no TEST_INTEGRITY_INDEX_UNAVAILABLE and no fail, with a python-not-found index and with none", async () => {
    // Control: the same change plus a modified tests/test_c.py with the python-not-found index is the whole-run error.
    const control = await run({
      diff: { text: JS_DIFF + PY_DIFF },
      testSources: {
        base: {
          files: [
            { path: JS_PATH, text: JS_BASE },
            { path: PY_PATH, text: PY_BASE },
          ],
          dropped: [],
        },
        head: {
          files: [
            { path: JS_PATH, text: JS_HEAD },
            { path: PY_PATH, text: PY_HEAD },
          ],
          dropped: [],
        },
      },
      pythonTestIndex: NOT_FOUND,
    });
    const controlMessages = control.messages.filter((m) => m.code === CODE);
    expect(controlMessages, "the control has one message").toHaveLength(1);
    expect(controlMessages[0]?.text, "the control is the whole-run form").toContain("TI02 and TI05 did not run");
    expect(controlMessages[0]?.level, "the control is an error").toBe("error");

    const testSources = {
      base: { files: [{ path: JS_PATH, text: JS_BASE }], dropped: [] },
      head: { files: [{ path: JS_PATH, text: JS_HEAD }], dropped: [] },
    };
    const withNotFound = await run({ diff: { text: JS_DIFF }, testSources, pythonTestIndex: NOT_FOUND });
    const withoutIndex = await run({ diff: { text: JS_DIFF }, testSources });
    for (const [name, report] of [
      ["python-not-found index", withNotFound],
      ["no Python index", withoutIndex],
    ] as const) {
      expect(
        report.messages.filter((m) => m.code === CODE),
        `${name}: no ${CODE}`,
      ).toEqual([]);
      expect(report.verdict, `${name}: verdict`).not.toBe("fail");
    }
  });
});
