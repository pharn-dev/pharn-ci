import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before the deleted-test-file
// message and fixtures/test-files-deleted/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_FILES_DELETED";

type Message = { level: string; code: string; text: string };

const lines = (path: string) => fixture(path).trim().split("\n");
const withCode = (messages: readonly Message[], code: string) => messages.filter((message) => message.code === code);

async function runCheck(diff: string) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
    diff: { text: fixture(`test-files-deleted/${diff}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: lines("test-files-deleted/files.txt"),
    // TI01 (test-file-detection-ti01) now reports deleted test files that define tests and raises the verdict in the
    // default mode. This file asserts that the TEST_FILES_DELETED message itself is info only, so the signals are off
    // here; the signal's own behaviour is covered by ac-ti01-*.test.ts.
    testIntegrityMode: { input: "off" as const },
  };
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("check(): a change that deletes or renames away a test file", () => {
  it.each([
    ["deleted-core-test.diff", "packages/core/test/lcov.test.ts"],
    ["deleted-spec.diff", "src/foo.spec.js"],
    ["deleted-test-dir.diff", "test/helpers.ts"],
    ["deleted-tests-dir.diff", "tests/a.py"],
    ["deleted-dunder-tests.diff", "src/__tests__/b.tsx"],
    ["renamed-test-away.diff", "src/x.test.ts"],
  ] as const)(
    "AC-1: %s yields one info TEST_FILES_DELETED naming %s, with the baseline verdict",
    async (diff, path) => {
      const baseline = await runCheck("baseline.diff");
      expect(withCode(baseline.messages, CODE)).toEqual([]);
      expect(baseline.verdict).toBe("pass");

      const report = await runCheck(diff);
      const messages = withCode(report.messages, CODE);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.level).toBe("info");
      expect(messages[0]?.text).toContain(`\`${path}\``);
      // Info only: the verdict is the one the same inputs give without the test-file entry.
      expect(report.verdict).toBe(baseline.verdict);
    },
  );

  it("AC-1: a non-test deletion, a test-to-test rename, a rename into a test directory and a modified test file yield no TEST_FILES_DELETED", async () => {
    // Control: the same fixtures do produce the message for a deleted test file, so its absence below comes from
    // the diff entries, not from the message being unwired.
    const control = await runCheck("deleted-test-dir.diff");
    expect(withCode(control.messages, CODE)).toHaveLength(1);

    for (const diff of [
      "deleted-contest.diff",
      "renamed-test-to-test.diff",
      "renamed-into-test.diff",
      "modified-test.diff",
    ]) {
      const report = await runCheck(diff);
      expect(withCode(report.messages, CODE), diff).toEqual([]);
    }
  });
});
