import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { PythonTestIndex } from "../src/testIndex/pythonSides.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-4). check() is loaded inside the test body: the AC test is written before an added `.py` test file the
// Python index did not read at HEAD fails closed in mode block, so nothing the build changes may run while the file
// loads. The diff adds one `.py` test file and modifies none; its head text is in the sources. The index is unavailable
// for each run-level reason (python-not-found included: no modified `.py` file makes it the whole-run form), or it ran
// and refused the added file for each per-file reason.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "tests/test_new.py";

const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

const DIFF = `${[
  `diff --git a/${PATH} b/${PATH}`,
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  `+++ b/${PATH}`,
  "@@ -0,0 +1,5 @@",
  ...PY_HEAD.slice(0, -1)
    .split("\n")
    .map((line) => `+${line}`),
].join("\n")}\n`;

const SOURCES = {
  base: { files: [], dropped: [] },
  head: { files: [{ path: PATH, text: PY_HEAD }], dropped: [] },
};

const RUN_LEVEL = [
  "python-not-found",
  "python-too-old",
  "python-failed",
  "timeout",
  "output-too-large",
  "bad-output",
] as const;
const REFUSALS = ["syntax-error", "too-deep", "too-large", "parser-threw"] as const;

const CASES: [string, string, PythonTestIndex][] = [
  ...RUN_LEVEL.map((reason): [string, string, PythonTestIndex] => [
    `a Python index unavailable as ${reason}`,
    reason,
    { available: false, reason },
  ]),
  ...REFUSALS.map((reason): [string, string, PythonTestIndex] => [
    `a Python index that refused the added file as ${reason}`,
    reason,
    { available: true, base: [], head: [{ path: PATH, result: { parsed: false, reason } }] },
  ]),
];

async function run(pythonTestIndex: PythonTestIndex, mode: "block" | "warn"): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/app.ts", "src/cart.ts"],
    testIntegrityMode: { input: mode },
    testSources: SOURCES,
    pythonTestIndex,
  });
  expectValidReport(report);
  return report;
}

describe("CORE-351: an added .py test file the Python index did not read fails closed in mode block", () => {
  it.each(CASES)(
    "AC-4: an added tests/test_new.py with %s gives the TEST_INTEGRITY_INDEX_UNAVAILABLE error naming it with its reason and the verdict fail in mode block, and a warning in mode warn",
    async (_, reason, pythonTestIndex) => {
      const block = await run(pythonTestIndex, "block");
      const blockMessages = block.messages.filter((m) => m.code === CODE);
      expect(blockMessages, `block: one ${CODE} message`).toHaveLength(1);
      expect(blockMessages[0]?.text, "block: it names the added file with its reason").toContain(
        `\`${PATH}\` (\`${reason}\`)`,
      );
      expect(blockMessages[0]?.level, "block: the message is an error").toBe("error");
      expect(block.verdict, "block: the verdict").toBe("fail");

      const warn = await run(pythonTestIndex, "warn");
      const warnMessages = warn.messages.filter((m) => m.code === CODE);
      expect(warnMessages, `warn: one ${CODE} message`).toHaveLength(1);
      expect(warnMessages[0]?.text, "warn: it names the added file with its reason").toContain(
        `\`${PATH}\` (\`${reason}\`)`,
      );
      expect(warnMessages[0]?.level, "warn: the message is a warning").toBe("warn");
    },
  );
});
