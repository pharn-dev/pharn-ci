import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// check() and the case fixtures are loaded inside each test body: these AC tests are written before the build writes
// the case directories under fixtures/test-integrity/TI01/, so nothing that depends on them may run while the file
// loads. A test file renamed so that its name matches no test basename pattern counts as renamed away even when its
// new path sits in a test directory (AC-1, AC-2); a rename that keeps a test basename, or a helper renamed inside a
// test directory, does not (AC-5, AC-6, AC-9).

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_FILES_DELETED";

type Mode = "block" | "warn";

async function runCase(caseDir: string, mode: Mode) {
  const { check } = await import("./text-coverage.js");
  const input: TextCheckInput = {
    version: "0.1.0",
    repoRoot: REPO_ROOT,
    threshold: 80,
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
    diff: { text: fixture(`test-integrity/TI01/${caseDir}/change.diff`) },
    repoFiles: fixture(`test-integrity/TI01/${caseDir}/files.txt`)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
    testIntegrityMode: { input: mode },
  };
  const report = check(input);
  expectValidReport(report);
  return report;
}

const ti01 = (report: Report) => report.testIntegrity.signals.filter((s) => s.id === "TI01");
const deletedMessages = (report: Report) => report.messages.filter((m) => (m.code as string) === CODE);

async function expectRenamedAway(caseDir: string, oldPath: string) {
  for (const mode of ["block", "warn"] as const) {
    const report = await runCase(caseDir, mode);

    const signals = ti01(report);
    expect(signals, `mode ${mode}`).toHaveLength(1);
    expect(signals[0]?.path, `mode ${mode}`).toBe(oldPath);
    expect(signals[0]?.severity, `mode ${mode}`).toBe(mode);

    const messages = deletedMessages(report);
    expect(messages, `mode ${mode}`).toHaveLength(1);
    expect(messages[0]?.text, `mode ${mode}`).toContain(oldPath);
  }
}

async function expectNotRenamedAway(caseDir: string) {
  const report = await runCase(caseDir, "block");

  expect(ti01(report)).toEqual([]);
  expect(deletedMessages(report)).toEqual([]);
}

describe("TI01 and TEST_FILES_DELETED: a test renamed so its name matches no test basename pattern", () => {
  it("AC-1: src/cart.test.ts renamed to src/__tests__/cart.test.ts.bak is one TI01 at the mode's level and is named in TEST_FILES_DELETED", async () => {
    await expectRenamedAway("block-rename-into-test-dir", "src/cart.test.ts");
  });

  it("AC-2: tests/test_cart.py renamed to tests/test_cart.txt is one TI01 at the mode's level and is named in TEST_FILES_DELETED", async () => {
    await expectRenamedAway("block-rename-py-to-txt", "tests/test_cart.py");
  });
});

describe("TI01 and TEST_FILES_DELETED: renames that are not renamed away", () => {
  it("AC-5: src/cart.test.ts renamed unedited to src/__tests__/cart.test.ts gives no TI01 and no TEST_FILES_DELETED", async () => {
    await expectNotRenamedAway("pass-rename-into-test-dir");
  });

  it("AC-6: src/cart.test.ts renamed unedited to src/cart.spec.ts gives no TI01 and no TEST_FILES_DELETED", async () => {
    await expectNotRenamedAway("pass-rename-test-to-spec");
  });

  it("AC-9: tests/helpers.ts renamed unedited to tests/helper.ts gives no TI01 and no TEST_FILES_DELETED", async () => {
    await expectNotRenamedAway("pass-helper-renamed-in-tests");
  });
});
