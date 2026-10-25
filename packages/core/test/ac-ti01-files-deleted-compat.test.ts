import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before TI01 exists, so nothing
// that depends on it may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_FILES_DELETED";
const DIFFS = [
  "deleted-core-test.diff",
  "deleted-spec.diff",
  "deleted-test-dir.diff",
  "deleted-tests-dir.diff",
  "deleted-dunder-tests.diff",
  "renamed-test-away.diff",
  "seven-deleted.diff",
];

async function runCheck(diff: string, mode?: "off") {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
    diff: { text: fixture(`test-files-deleted/${diff}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    ...(mode === undefined ? {} : { testIntegrityMode: { input: mode } }),
  };
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("check(): TEST_FILES_DELETED is unchanged by TI01", () => {
  it("AC-9: every existing deleted-test fixture still yields one info TEST_FILES_DELETED, and with the mode off the verdict of the baseline", async () => {
    // Control: the new detection reads these fixtures. deleted-dunder-tests.diff removes `it(` lines from a test file
    // while its package keeps its source, so TI01 fires on it in the default mode.
    const control = await runCheck("deleted-dunder-tests.diff");
    expect(control.testIntegrity.signals.map((s) => s.id)).toEqual(["TI01"]);

    const baseline = await runCheck("baseline.diff", "off");
    for (const diff of DIFFS) {
      const report = await runCheck(diff);
      const messages = report.messages.filter((m) => m.code === CODE);
      expect(messages, diff).toHaveLength(1);
      expect(messages[0]?.level, diff).toBe("info");
      expect(messages[0]?.text.startsWith("This change deletes or renames away test files: "), diff).toBe(true);
      expect(
        messages[0]?.text.endsWith("Check that the tests they held were meant to go before trusting the result."),
        diff,
      ).toBe(true);

      const off = await runCheck(diff, "off");
      expect(
        off.messages.filter((m) => m.code === CODE),
        diff,
      ).toHaveLength(1);
      expect(off.testIntegrity.signals, diff).toEqual([]);
      expect(off.verdict, diff).toBe(baseline.verdict);
    }
  });
});
