import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before TI01 and
// fixtures/test-integrity/TI01/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/__tests__/b.test.ts";

async function runCheck(testIntegrityMode?: { input: "block" | "warn" | "off" }) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
    diff: { text: fixture("test-integrity/TI01/block-code-stays.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    ...(testIntegrityMode === undefined ? {} : { testIntegrityMode }),
  };
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const withCode = (report: Awaited<ReturnType<typeof runCheck>>, code: string) =>
  report.messages.filter((m) => (m.code as string) === code);

describe("check(): TI01 in the default mode and in mode off", () => {
  it("AC-5: with no mode given the signal is warn and the report warns", async () => {
    const report = await runCheck();

    expect(report.testIntegrity.mode).toBe("warn");
    expect(report.testIntegrity.signals).toHaveLength(1);
    expect(report.testIntegrity.signals[0]?.id).toBe("TI01");
    expect(report.testIntegrity.signals[0]?.path).toBe(PATH);
    expect(report.testIntegrity.signals[0]?.severity).toBe("warn");
    expect(report.testIntegrity.verdict).toBe("warn");

    const messages = withCode(report, "TEST_INTEGRITY_TI01");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(report.verdict).toBe("warn");
  });

  it("AC-5: with mode off no signal is computed, the block stays pass and the OFF message is present", async () => {
    // Control: the same inputs do produce the signal in the default mode, so the empty result below is the mode's doing.
    expect((await runCheck()).testIntegrity.signals).toHaveLength(1);

    const report = await runCheck({ input: "off" });

    expect(report.testIntegrity.mode).toBe("off");
    expect(report.testIntegrity.signals).toEqual([]);
    expect(report.testIntegrity.verdict).toBe("pass");
    expect(withCode(report, "TEST_INTEGRITY_TI01")).toEqual([]);
    expect(withCode(report, "TEST_INTEGRITY_OFF")).toHaveLength(1);
  });
});
