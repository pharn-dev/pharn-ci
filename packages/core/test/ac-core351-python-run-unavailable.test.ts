import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// CORE-351 (AC-1). check() is loaded inside the test body: the AC test is written before a Python index that did not
// run (for a reason other than python-not-found) fails a modified `.py` test file closed in mode block, so nothing the
// build changes may run while the file loads. The base and head text of the one modified file are in the sources; the
// index reports each run-level reason in turn.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "tests/test_c.py";

const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n    assert total([1]) == 1\n";

const DIFF = `${[
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  "@@ -5,0 +6 @@ def test_adds():",
  "+    assert total([1]) == 1",
  "@@ -6,4 +6,0 @@",
  "-",
  "-",
  "-def test_empty():",
  "-    assert total([]) == 0",
].join("\n")}\n`;

const SOURCES = {
  base: { files: [{ path: PATH, text: PY_BASE }], dropped: [] },
  head: { files: [{ path: PATH, text: PY_HEAD }], dropped: [] },
};

async function run(input: Partial<TextCheckInput>): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/app.ts", "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    testSources: SOURCES,
    ...input,
  });
  expectValidReport(report);
  return report;
}

describe("CORE-351: a Python index that did not run fails a modified .py test file closed in mode block", () => {
  it.each(["python-too-old", "python-failed", "timeout", "output-too-large", "bad-output"] as const)(
    "AC-1: with the Python index unavailable as %s, the modified tests/test_c.py gives one TEST_INTEGRITY_INDEX_UNAVAILABLE error naming the file with that reason, and the verdict is fail",
    async (reason) => {
      const report = await run({ pythonTestIndex: { available: false, reason } });
      const messages = report.messages.filter((m) => m.code === CODE);
      expect(messages, `one ${CODE} message`).toHaveLength(1);
      expect(messages[0]?.text, "it names the file with the reason").toContain(`\`${PATH}\` (\`${reason}\`)`);
      expect(messages[0]?.level, "the message is an error in mode block").toBe("error");
      expect(report.verdict, "the verdict").toBe("fail");
    },
  );
});
