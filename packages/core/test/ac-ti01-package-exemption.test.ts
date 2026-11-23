import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the case fixtures are loaded inside each test body: these AC tests are written before the build writes
// the case directories under fixtures/test-integrity/TI01/, so nothing that depends on them may run while the file
// loads. A deleted test file is softened to info by its package only when deleted JS/TS or Python source files of the
// package go with it and no JS/TS or Python file of the package is left in the tracked-file list (AC-3, AC-4, AC-7);
// the same-name exemption is unchanged (AC-8).

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart/cart.test.ts";
const PACKAGE_DETAIL = "Test file deleted together with other files of its package.";
const SAME_STEM_DETAIL = "Test file deleted together with a source file of the same name.";

type Mode = "block" | "warn";

async function runCase(caseDir: string, mode: Mode) {
  const { check } = await import("./text-coverage.js");
  const input = {
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
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti01 = (report: Report) => report.testIntegrity.signals.filter((s) => s.id === "TI01");

async function expectAtModeLevel(caseDir: string) {
  for (const mode of ["block", "warn"] as const) {
    const signals = ti01(await runCase(caseDir, mode));
    expect(signals, `mode ${mode}`).toHaveLength(1);
    expect(signals[0]?.path, `mode ${mode}`).toBe(PATH);
    expect(signals[0]?.severity, `mode ${mode}`).toBe(mode);
  }
}

async function expectInfo(caseDir: string, detail: string) {
  const signals = ti01(await runCase(caseDir, "block"));
  expect(signals).toHaveLength(1);
  expect(signals[0]?.path).toBe(PATH);
  expect(signals[0]?.severity).toBe("info");
  expect(signals[0]?.detail).toBe(detail);
}

describe("TI01 package exemption: a deleted test file whose package code stays is not softened", () => {
  it("AC-3: src/cart/cart.test.ts deleted with src/cart/NOTES.md while src/cart/cart.ts stays is one TI01 at the mode's level", async () => {
    await expectAtModeLevel("block-package-notes-deleted");
  });

  it("AC-4: src/cart/cart.test.ts deleted with src/cart/util.ts while src/cart/cart.ts stays is one TI01 at the mode's level", async () => {
    await expectAtModeLevel("block-package-code-stays");
  });
});

describe("TI01 exemptions that still give info", () => {
  it("AC-7: a whole package deleted (price.ts, util.ts, cart.test.ts) with nothing left under src/cart/ is one info TI01 with the package detail", async () => {
    await expectInfo("info-package-deleted-whole", PACKAGE_DETAIL);
  });

  it("AC-8: src/cart/cart.test.ts deleted with src/cart/cart.ts while src/cart/util.ts stays is one info TI01 with the same-name detail", async () => {
    await expectInfo("info-same-stem-code-stays", SAME_STEM_DETAIL);
  });
});
