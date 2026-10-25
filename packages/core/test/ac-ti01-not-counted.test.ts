import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before TI01 and
// fixtures/test-integrity/TI01/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

async function runCheck(diff: string) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
    diff: { text: fixture(`test-integrity/TI01/${diff}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" as const },
  };
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const withCode = (report: Awaited<ReturnType<typeof runCheck>>, code: string) =>
  report.messages.filter((m) => (m.code as string) === code);

describe("check(): files TI01 does not count", () => {
  it.each([
    ["pass-helper.diff", "tests/helpers.ts", true],
    ["pass-init-py.diff", "tests/__init__.py", true],
    ["pass-fixture-json.diff", "tests/fixtures/data.json", true],
    ["pass-binary.diff", "tests/img.test.ts", false],
  ] as const)("AC-6: %s deletes %s and yields no TI01 signal", async (diff, path, named) => {
    // Control: the fixture is read and holds the path, so the empty result below is a decision, not a missing file.
    expect(fixture(`test-integrity/TI01/${diff}`)).toContain(path);

    const report = await runCheck(diff);
    expect(report.testIntegrity.mode).toBe("block");
    expect(report.testIntegrity.signals).toEqual([]);
    expect(withCode(report, "TEST_INTEGRITY_TI01")).toEqual([]);
    expect(report.testIntegrity.verdict).toBe("pass");

    // TEST_FILES_DELETED still names the non-binary test paths, as before.
    const deleted = withCode(report, "TEST_FILES_DELETED");
    if (named) {
      expect(deleted).toHaveLength(1);
      expect(deleted[0]?.text).toContain(`\`${path}\``);
    }
  });
});
