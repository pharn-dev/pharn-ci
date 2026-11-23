import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// CORE-351 (AC-2). check() is loaded inside the test body: the AC test is written before the build. In mode warn the
// per-file TEST_INTEGRITY_INDEX_UNAVAILABLE message stays a warning, which already holds today; so each test also runs
// the same inputs in mode block as its control, which must give the error AC-1 asks for (and does not before the
// build).

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
    testSources: SOURCES,
    ...input,
  });
  expectValidReport(report);
  return report;
}

describe("CORE-351: in mode warn a Python index that did not run stays a warning", () => {
  it.each(["python-too-old", "python-failed", "timeout", "output-too-large", "bad-output"] as const)(
    "AC-2: with the Python index unavailable as %s in mode warn, the TEST_INTEGRITY_INDEX_UNAVAILABLE message is a warning and nothing in the report is at an error or block level (mode block on the same inputs is the error control)",
    async (reason) => {
      const pythonTestIndex = { available: false as const, reason };

      // Control: the same inputs in mode block give the error (AC-1).
      const block = await run({ pythonTestIndex, testIntegrityMode: { input: "block" } });
      expect(
        block.messages.filter((m) => m.code === CODE).map((m) => m.level),
        "control: mode block gives one error",
      ).toEqual(["error"]);

      const warn = await run({ pythonTestIndex, testIntegrityMode: { input: "warn" } });
      const messages = warn.messages.filter((m) => m.code === CODE);
      expect(messages, `one ${CODE} message`).toHaveLength(1);
      expect(messages[0]?.text, "it names the file with the reason").toContain(`\`${PATH}\` (\`${reason}\`)`);
      expect(messages[0]?.level, "the message is a warning in mode warn").toBe("warn");
      expect(
        warn.messages.filter((m) => m.level === "error"),
        "no message is an error",
      ).toEqual([]);
      expect(
        warn.testIntegrity.signals.filter((s) => s.severity === "block"),
        "no signal is at block level",
      ).toEqual([]);
      expect(warn.verdict, "the verdict is not fail").not.toBe("fail");
    },
  );
});
