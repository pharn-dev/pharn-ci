import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// ti17-always-true-matcher-2, AC-1. check() is loaded inside the test body: the AC test is written before TI17 exists,
// so nothing the build adds may run while this file loads. The benchmark case is read unchanged (its change.diff and
// files.txt only, no base or head sources); the expected signal is written here, never read from a fixture.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CASE = "skylos-nine/always-true-matcher";
/** A coverage file that covers the case's source file, so diff coverage passes and only test integrity speaks. */
const PASSING_LCOV = "SF:src/cart.ts\nDA:1,1\nend_of_record\n";

describe("TI17 on the vitest Skylos case always-true-matcher", () => {
  it("AC-1: the unchanged benchmark diff in mode block gives a schema-valid report with exactly one TI17 warn signal at src/cart.test.ts:9 and one TEST_INTEGRITY_TI17 warn message", async () => {
    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: PASSING_LCOV, format: "lcov" },
      diff: { text: fixture(`${CASE}/change.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture(`${CASE}/files.txt`).trim().split("\n"),
      testIntegrityMode: { input: "block" },
    } as Parameters<typeof check>[0]);
    expectValidReport(report);

    expect(
      report.testIntegrity.signals.map((s) => ({ id: String(s.id), severity: s.severity, path: s.path, line: s.line })),
    ).toEqual([{ id: "TI17", severity: "warn", path: "src/cart.test.ts", line: 9 }]);

    const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI17");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
  });
});
