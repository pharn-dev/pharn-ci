import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before TI01 and
// fixtures/test-integrity/TI01/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

async function runCheck(diffPath: string) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
    diff: { text: fixture(diffPath) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" as const },
  };
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("check(): TI01 exemptions make the finding info", () => {
  it.each([
    ["info-with-source.diff", "src/foo.test.ts"],
    ["info-package-removed.diff", "packages/a/__tests__/y.test.ts"],
    ["info-migration-ts.diff", "lib/x.test.js"],
    ["info-migration-mjs.diff", "lib/x.test.js"],
  ] as const)("AC-7: %s leaves %s as an info signal", async (diff, path) => {
    const baseline = await runCheck("test-files-deleted/baseline.diff");
    const report = await runCheck(`test-integrity/TI01/${diff}`);

    expect(report.testIntegrity.signals).toHaveLength(1);
    const signal = report.testIntegrity.signals[0];
    expect(signal?.id).toBe("TI01");
    expect(signal?.path).toBe(path);
    expect(signal?.severity).toBe("info");
    expect(signal?.detail.length).toBeGreaterThan(0);
    expect(signal?.detail.length).toBeLessThanOrEqual(300);

    expect(report.testIntegrity.verdict).toBe("pass");
    const messages = report.messages.filter((m) => (m.code as string) === "TEST_INTEGRITY_TI01");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("info");
    expect(report.verdict).toBe(baseline.verdict);
  });
});
