import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// F-31: an ungated measurement says so, threshold 0 is explicit, and the gate compares exactly.
// The golden fixtures cover 5 of 7 added lines: 71.428...%, shown as 71.43%.
const repoFiles = fixture("golden/files.txt").trim().split("\n");

function goldenReport(threshold: number | null) {
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold,
    repoFiles,
  });
}

describe("DIFF_COVERAGE_UNGATED", () => {
  it("is reported as info, with the percent, when coverage is measured and no threshold is set", () => {
    const report = goldenReport(null);
    expectValidReport(report);
    expect(report.verdict).toBe("pass");
    expect(report.diffCoverage).toMatchObject({ percent: 71.43, threshold: null });
    expect(report.messages).toEqual([
      { level: "info", code: "DIFF_COVERAGE_UNGATED", text: "Diff coverage 71.43% is not gated: no threshold is set." },
    ]);
    expect(renderMarkdown(report)).toContain("`DIFF_COVERAGE_UNGATED` Diff coverage 71.43% is not gated");
  });

  it("is reported for threshold 0, which accepts any coverage", () => {
    const report = goldenReport(0);
    expectValidReport(report);
    expect(report.verdict).toBe("pass");
    expect(report.diffCoverage?.threshold).toBe(0);
    expect(report.messages).toEqual([
      {
        level: "info",
        code: "DIFF_COVERAGE_UNGATED",
        text: "Diff coverage 71.43% is not gated: a threshold of 0% accepts any coverage.",
      },
    ]);
  });

  it("is not reported when a threshold above 0 gates the percent", () => {
    for (const threshold of [70, 80]) {
      const codes = goldenReport(threshold).messages.map((m) => m.code);
      expect(codes).not.toContain("DIFF_COVERAGE_UNGATED");
    }
  });

  it("is not reported when nothing was measured", () => {
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("diff/empty.diff") },
      threshold: null,
      repoFiles,
    });
    expectValidReport(report);
    expect(report.messages.map((m) => m.code)).toEqual(["NO_COVERABLE_CHANGES"]);
  });
});

describe("threshold 0", () => {
  it("still fails closed when coverage cannot be measured, like any threshold", () => {
    const report = check({
      version: "0.1.0",
      coverage: { missingFile: "coverage/lcov.info" },
      diff: { text: fixture("golden/pr.diff") },
      threshold: 0,
      repoFiles,
    });
    expectValidReport(report);
    expect(report.verdict).toBe("fail");
    expect(report.messages.map((m) => [m.level, m.code])).toEqual([["error", "COVERAGE_FILE_MISSING"]]);
  });
});

describe("exact threshold comparison", () => {
  it("fails 71.428...% at 71.43 and shows 71.42%, so the text never reads as meeting the threshold", () => {
    const report = goldenReport(71.43);
    expectValidReport(report);
    expect(report.verdict).toBe("fail");
    expect(report.diffCoverage?.percent).toBe(71.42);
    expect(report.messages).toEqual([
      {
        level: "error",
        code: "DIFF_COVERAGE_BELOW_THRESHOLD",
        text: "Diff coverage 71.42% is below the threshold of 71.43%.",
      },
    ]);
    expect(renderMarkdown(report)).toContain("**71.42%** of changed lines covered (5/7, threshold 71.43%)");
  });

  it("passes at 71.42 with the usual rounded 71.43%", () => {
    const report = goldenReport(71.42);
    expectValidReport(report);
    expect(report.verdict).toBe("pass");
    expect(report.diffCoverage?.percent).toBe(71.43);
    expect(report.messages).toEqual([]);
  });
});
