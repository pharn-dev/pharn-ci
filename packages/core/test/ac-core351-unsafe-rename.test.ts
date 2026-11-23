import { describe, expect, it } from "vitest";
import type { PythonTestIndex } from "../src/testIndex/pythonSides.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-17), the regression the ticket names: a pull request renames a test file to a test path whose name holds
// a control character (a tab here, which git writes as a C-quoted path, `"b/tests/test_\ta.py"`), so the sources reader
// refuses the head path as unsafe-path while the base text is read; the rename also removes a test. check() is loaded
// inside the test body: the AC test is written before the build, so nothing the build changes may run while the file
// loads. The message names the head path through a code span, which writes the control character as U+FFFD.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

interface Case {
  name: string;
  oldPath: string;
  /** The new path as git quotes it (the part inside the quotes, after `b/`). */
  quoted: string;
  /** The new path as it is, with the control character. */
  newPath: string;
  /** The new path as the message's code span writes it. */
  shown: string;
  base: string;
  removed: string[];
  hunk: string;
  index?: (base: string) => PythonTestIndex;
}

const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const TS_LINES = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
];

const CASES: Case[] = [
  {
    name: "test_a.py",
    oldPath: "tests/test_a.py",
    quoted: "tests/test_\\ta.py",
    newPath: "tests/test_\ta.py",
    shown: "tests/test_�a.py",
    base: PY_BASE,
    hunk: "@@ -6,4 +5,0 @@",
    removed: ["", "", "def test_empty():", "    assert total([]) == 0"],
    index: (base) => ({
      available: true,
      base: [{ path: base, result: { parsed: true, syntaxErrors: 0, tests: [], mocks: [] } }],
      head: [],
    }),
  },
  {
    name: "a.test.ts",
    oldPath: "src/a.test.ts",
    quoted: "src/a\\t.test.ts",
    newPath: "src/a\t.test.ts",
    shown: "src/a�.test.ts",
    base: `${TS_LINES.join("\n")}\n`,
    hunk: "@@ -7,4 +6,0 @@",
    removed: TS_LINES.slice(6, 10),
  },
];

function diffOf(c: Case): string {
  return `${[
    `diff --git a/${c.oldPath} "b/${c.quoted}"`,
    "similarity index 80%",
    `rename from ${c.oldPath}`,
    `rename to "${c.quoted}"`,
    "index 1111111..2222222 100644",
    `--- a/${c.oldPath}`,
    `+++ "b/${c.quoted}"`,
    c.hunk,
    ...c.removed.map((line) => `-${line}`),
  ].join("\n")}\n`;
}

describe("CORE-351: a rename to a test path the sources reader refuses fails in mode block", () => {
  it.each(CASES)(
    "AC-17: renaming $name to a test path with a control character, written as git's quoted path, with the head dropped as unsafe-path, gives the TEST_INTEGRITY_INDEX_UNAVAILABLE error naming the head path with unsafe-path and the verdict fail",
    async (c) => {
      const { check } = await import("./text-coverage.js");
      const report = check({
        version: "0.1.0",
        coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
        diff: { text: diffOf(c) },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: null,
        repoFiles: [c.newPath, "src/app.ts", "src/cart.ts"].sort(),
        testIntegrityMode: { input: "block" },
        testSources: {
          base: { files: [{ path: c.oldPath, text: c.base }], dropped: [] },
          head: { files: [], dropped: [{ path: c.newPath, reason: "unsafe-path" }] },
        },
        ...(c.index === undefined ? {} : { pythonTestIndex: c.index(c.oldPath) }),
      });
      expectValidReport(report);

      const messages = report.messages.filter((m) => m.code === CODE);
      expect(messages, `one ${CODE} message`).toHaveLength(1);
      expect(messages[0]?.text, "it names the head path with unsafe-path").toContain(
        `\`${c.shown}\` (\`unsafe-path\`)`,
      );
      expect(messages[0]?.level, "the message is an error in mode block").toBe("error");
      expect(report.verdict, "the verdict").toBe("fail");
    },
  );
});
