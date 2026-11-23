import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a reported python-not-found index
// with a modified `.py` test file becomes the whole-run form, so nothing the build changes may run while the file
// loads. No index, or an index unavailable for another reason, keeps today's per-file warning; the python-not-found
// index on the same input is the control, in the same test, that fails before the build.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "tests/test_c.py";

interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  verdict: string;
  messages: Message[];
}

const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

const DIFF = `${[
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  "@@ -6,4 +5,0 @@",
  "-",
  "-",
  "-def test_empty():",
  "-    assert total([]) == 0",
].join("\n")}\n`;
const READABLE = {
  base: { files: [{ path: PATH, text: PY_BASE }], dropped: [] },
  head: { files: [{ path: PATH, text: PY_HEAD }], dropped: [] },
};

async function run(input: Record<string, unknown>): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    ...input,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("CORE-69: a modified Python test file keeps the per-file warning unless python3 was reported missing", () => {
  it("AC-14: a modified tests/test_c.py with no Python index (text dropped on both sides, or readable) or a python-too-old index gives one per-file TEST_INTEGRITY_INDEX_UNAVAILABLE warning, no error, and the verdict warn", async () => {
    // Control: readable text with a python-not-found index is the whole-run error.
    const control = await run({
      testSources: READABLE,
      pythonTestIndex: { available: false, reason: "python-not-found", detail: "python3: command not found" },
    });
    const controlMessages = control.messages.filter((m) => m.code === CODE);
    expect(controlMessages, "the control has one message").toHaveLength(1);
    expect(controlMessages[0]?.text, "the control is the whole-run form").toContain("TI02 and TI05 did not run");
    expect(controlMessages[0]?.level, "the control is an error").toBe("error");

    const cases: [string, Record<string, unknown>][] = [
      [
        "no index, dropped as too-large on both sides",
        {
          testSources: {
            base: { files: [], dropped: [{ path: PATH, reason: "too-large" }] },
            head: { files: [], dropped: [{ path: PATH, reason: "too-large" }] },
          },
        },
      ],
      ["no index, readable on both sides", { testSources: READABLE }],
      [
        "python-too-old index",
        {
          testSources: READABLE,
          pythonTestIndex: { available: false, reason: "python-too-old", detail: "Python 3.6.9" },
        },
      ],
    ];
    for (const [name, input] of cases) {
      const report = await run(input);
      const messages = report.messages.filter((m) => m.code === CODE);
      expect(messages, `${name}: one ${CODE} message`).toHaveLength(1);
      expect(messages[0]?.level, `${name}: level`).toBe("warn");
      expect(messages[0]?.text, `${name}: names the file`).toContain(PATH);
      expect(messages[0]?.text, `${name}: the per-file form`).not.toContain("did not run");
      expect(
        report.messages.filter((m) => m.level === "error"),
        `${name}: no error`,
      ).toEqual([]);
      expect(report.verdict, `${name}: verdict`).toBe("warn");
    }
  });
});
