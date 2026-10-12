import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// buildReport is loaded inside the test body, like the other AC tests: they are written before the build.
// One rule for the four "diff coverage could not be computed" codes: an error with a threshold (0 counts as set),
// a warning without one.

const base = { version: "0.1.0", agentSetup: { files: [{ path: "CLAUDE.md", kind: "claude-md" as const }] } };

type Missing =
  | { reason: "diff-unavailable"; detail: string }
  | { reason: "coverage-file-missing"; coverageFile: string }
  | { reason: "coverage-file-empty"; coverageFile: string }
  | { reason: "coverage-format-unsupported"; coverageFile: string };

async function reportFor(missing: Missing, threshold: number | null) {
  const { buildReport } = await import("../src/report.js");
  return buildReport({ ...base, threshold, diffCoverage: null, missing } as never);
}

const levelOf = (report: { messages: { level: string; code: string }[] }, code: string) =>
  report.messages.filter((message) => message.code === code).map((message) => message.level);

describe("buildReport: missing inputs share one level rule", () => {
  it("AC-1: makes DIFF_UNAVAILABLE an error with a threshold (80 or 0) and a warning without, and the coverage codes follow the same rule", async () => {
    const diff: Missing = { reason: "diff-unavailable", detail: "no base" };
    for (const [threshold, level, verdict] of [
      [80, "error", "fail"],
      [0, "error", "fail"],
      [null, "warn", "warn"],
    ] as const) {
      const label = `diff-unavailable, threshold ${threshold}`;
      const report = await reportFor(diff, threshold);
      expectValidReport(report);
      expect(report.diffCoverage, label).toBeNull();
      expect(levelOf(report, "DIFF_UNAVAILABLE"), label).toEqual([level]);
      expect(report.verdict, label).toBe(verdict);
    }

    const coverageCases: [Missing, string][] = [
      [{ reason: "coverage-file-missing", coverageFile: "coverage/lcov.info" }, "COVERAGE_FILE_MISSING"],
      [{ reason: "coverage-file-empty", coverageFile: "coverage/lcov.info" }, "COVERAGE_FILE_EMPTY"],
      [{ reason: "coverage-format-unsupported", coverageFile: "coverage.xml" }, "COVERAGE_FORMAT_UNSUPPORTED"],
    ];
    for (const [missing, code] of coverageCases) {
      for (const [threshold, level, verdict] of [
        [80, "error", "fail"],
        [null, "warn", "warn"],
      ] as const) {
        const label = `${missing.reason}, threshold ${threshold}`;
        const report = await reportFor(missing, threshold);
        expectValidReport(report);
        expect(levelOf(report, code), label).toEqual([level]);
        expect(report.verdict, label).toBe(verdict);
      }
    }
  });
});
