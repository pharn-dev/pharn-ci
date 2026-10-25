import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before TI01 and
// fixtures/test-integrity/TI01/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Diff = { text: string } | { parsed: unknown[] };

async function runCheck(diff: Diff) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
    diff,
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" as const },
  };
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const TRUNCATED = {
  path: "tests/t.test.ts",
  oldPath: "tests/t.test.ts",
  status: "deleted",
  addedLines: [],
  hunks: [{ oldStart: 1, newStart: 0, added: [], removed: [{ line: 1, text: "// header" }] }],
  textTruncated: true,
};

describe("check(): files TI01 counts as block", () => {
  it.each([
    [
      "a repository-root tests folder deleted with an unrelated source file",
      "block-root-tests.diff",
      "tests/test_a.py",
    ],
    ["a test renamed away to a non-test path with no hunk", "block-rename-away.diff", "src/x.test.ts"],
    ["a test deleted while its source stays", "block-code-stays.diff", "src/__tests__/b.test.ts"],
  ] as const)("AC-8: %s", async (_label, diff, path) => {
    const report = await runCheck({ text: fixture(`test-integrity/TI01/${diff}`) });
    expect(report.testIntegrity.signals).toHaveLength(1);
    expect(report.testIntegrity.signals[0]?.id).toBe("TI01");
    expect(report.testIntegrity.signals[0]?.path).toBe(path);
    expect(report.testIntegrity.signals[0]?.severity).toBe("block");
    expect(report.testIntegrity.verdict).toBe("fail");
  });

  it("AC-8: a deleted test file whose kept text was truncated before any test-defining line counts", async () => {
    const report = await runCheck({ parsed: [TRUNCATED] });
    expect(report.testIntegrity.signals).toHaveLength(1);
    expect(report.testIntegrity.signals[0]?.path).toBe("tests/t.test.ts");
    expect(report.testIntegrity.signals[0]?.severity).toBe("block");
    expect(report.testIntegrity.verdict).toBe("fail");
  });
});
