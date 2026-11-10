import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// ti17-always-true-matcher-2, AC-14. check() is loaded inside the test body: the AC test is written before TI17 exists.
// The change is the vitest Skylos case always-true-matcher, with a coverage file that covers its source file so diff
// coverage passes and TI17 is the only finding.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CASE = "skylos-nine/always-true-matcher";
const PASSING_LCOV = "SF:src/cart.ts\nDA:1,1\nend_of_record\n";
const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");

async function run(mode: "block" | "warn" | "off") {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: PASSING_LCOV, format: "lcov" },
    diff: { text: fixture(`${CASE}/change.diff`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture(`${CASE}/files.txt`).trim().split("\n"),
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("TI17 in the test-integrity modes", () => {
  it("AC-14: in modes block and warn the TI17 signal and its message are warn and the verdict is warn; in mode off there is no TI17 signal, no TEST_INTEGRITY_TI17 message and the verdict is pass", async () => {
    for (const mode of ["block", "warn"] as const) {
      const report = await run(mode);
      const signals = report.testIntegrity.signals.filter((s) => String(s.id) === ID);
      expect(
        signals.map((s) => s.severity),
        `${mode}: TI17 severity`,
      ).toEqual(["warn"]);
      const messages = report.messages.filter((m) => String(m.code) === CODE);
      expect(
        messages.map((m) => m.level),
        `${mode}: TEST_INTEGRITY_TI17 level`,
      ).toEqual(["warn"]);
      expect(report.verdict, `${mode}: verdict`).toBe("warn");
    }

    const off = await run("off");
    expect(off.testIntegrity.signals.filter((s) => String(s.id) === ID)).toEqual([]);
    expect(off.messages.filter((m) => String(m.code) === CODE)).toEqual([]);
    expect(off.verdict).toBe("pass");
  });
});
