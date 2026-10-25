import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before TI01 and
// fixtures/test-integrity/TI01/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/__tests__/b.test.ts";

type Mode = "block" | "warn" | "off";

async function runCheck(diff: string, mode?: Mode) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
    diff: { text: fixture(`test-integrity/TI01/${diff}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    ...(mode === undefined ? {} : { testIntegrityMode: { input: mode } }),
  };
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("check(): TI01 in mode block", () => {
  it("AC-4: a deleted test file that defines tests while its source stays is a block signal and fails the report", async () => {
    const report = await runCheck("block-code-stays.diff", "block");

    expect(report.testIntegrity.mode).toBe("block");
    expect(report.testIntegrity.signals).toHaveLength(1);
    const signal = report.testIntegrity.signals[0];
    expect(signal?.id).toBe("TI01");
    expect(signal?.severity).toBe("block");
    expect(signal?.path).toBe(PATH);
    expect(signal?.line).toBeNull();
    expect(typeof signal?.detail).toBe("string");
    expect(signal?.detail.length).toBeGreaterThan(0);
    expect(signal?.detail.length).toBeLessThanOrEqual(300);
    // No removed line text reaches the report.
    expect(signal?.detail).not.toContain("adds");
    expect(JSON.stringify(report)).not.toContain('it("adds"');

    expect(report.testIntegrity.verdict).toBe("fail");

    const messages = report.messages.filter((m) => (m.code as string) === "TEST_INTEGRITY_TI01");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(messages[0]?.text).toContain(`\`${PATH}\``);

    expect(report.verdict).toBe("fail");
  });
});
