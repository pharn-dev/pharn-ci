import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before the coverage root and
// fixtures/coverage-paths/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Message = { code: string };

async function runCheck(coverage: { text: string; format: "lcov" | "cobertura" }, diffPath: string) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage,
    diff: { text: fixture(diffPath) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("coverage-paths/package-relative/files.txt").trim().split("\n"),
    coverageRoot: "packages/core",
  };
  return check(input as Parameters<typeof check>[0]);
}

const pathCodes = (messages: readonly Message[]) =>
  messages.map((message) => message.code).filter((code) => code.startsWith("COVERAGE_PATHS_"));

describe("check(): the coverage root", () => {
  it("AC-3: coverage root packages/core measures package-relative lcov and Cobertura at the repo path", async () => {
    for (const [label, coverage] of [
      ["lcov", { text: fixture("coverage-paths/package-relative/coverage.info"), format: "lcov" }],
      ["cobertura", { text: fixture("coverage-paths/package-relative/coverage.xml"), format: "cobertura" }],
    ] as const) {
      const report = await runCheck(coverage, "coverage-paths/package-relative/pr.diff");
      expectValidReport(report);
      expect(pathCodes(report.messages), label).toEqual([]);
      expect(report.diffCoverage, label).not.toBeNull();
      expect(
        report.diffCoverage?.files.map(({ path, coveredLines, coverableLines }) => ({
          path,
          coveredLines,
          coverableLines,
        })),
        label,
      ).toEqual([{ path: "packages/core/src/a.ts", coveredLines: 4, coverableLines: 5 }]);
      expect(report.diffCoverage?.percent, label).toBe(80);
      // 80% against a threshold of 80 (inclusive) passes.
      expect(report.verdict, label).toBe("pass");
    }
  });

  it("AC-3: an absolute path under the repo root is measured at its repo path, without the coverage root in front", async () => {
    const report = await runCheck(
      { text: fixture("coverage-paths/mixed/coverage.info"), format: "lcov" },
      "coverage-paths/mixed/pr.diff",
    );
    expectValidReport(report);
    expect(pathCodes(report.messages)).toEqual([]);
    expect(
      report.diffCoverage?.files.map(({ path, coveredLines, coverableLines }) => ({
        path,
        coveredLines,
        coverableLines,
      })),
    ).toEqual([
      { path: "packages/core/src/a.ts", coveredLines: 4, coverableLines: 5 },
      { path: "packages/core/src/b.ts", coveredLines: 1, coverableLines: 2 },
    ]);
    // 5 of 7 changed lines covered is 71.43%, below 80.
    expect(report.diffCoverage?.percent).toBe(71.43);
    expect(report.verdict).toBe("fail");
  });
});
