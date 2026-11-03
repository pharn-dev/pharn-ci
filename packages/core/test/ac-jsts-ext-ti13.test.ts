import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded from the package inside each test body: the AC test is written before `.test.mts` files are
// test files by name, so nothing the build changes may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TEST_PATH = "src/cart.test.mts";
const SOURCE_PATH = "src/cart.mts";
const REPO_FILES = ["package.json", SOURCE_PATH, TEST_PATH];
const HINT = "/* istanbul ignore next */";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}

/** A modified file with one line added at line 12 (a `--unified=0` hunk). */
function addLine(path: string, line: string): string {
  return `${[
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -11,0 +12 @@",
    `+${line}`,
  ].join("\n")}\n`;
}

async function run(path: string) {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: addLine(path, HINT) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti13 = (report: Awaited<ReturnType<typeof run>>) =>
  (report.testIntegrity.signals as unknown as Signal[]).filter((s) => String(s.id) === "TI13");

describe("check(): TI13 and a .test.mts test file", () => {
  it("AC-4: an Istanbul hint added to src/cart.test.mts gives no TI13, while the same line added to src/cart.mts gives TI13 at block", async () => {
    const inTest = await run(TEST_PATH);
    expect(ti13(inTest), "no TI13 in the test file").toEqual([]);
    expect(inTest.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI13")).toEqual([]);

    const inSource = await run(SOURCE_PATH);
    const signals = ti13(inSource);
    expect(signals, "one TI13 in the source file").toHaveLength(1);
    expect(signals[0]?.severity).toBe("block");
    expect(signals[0]?.path).toBe(SOURCE_PATH);
    expect(signals[0]?.line).toBe(12);
  });
});
