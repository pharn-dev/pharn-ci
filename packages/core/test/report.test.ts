import { describe, expect, it } from "vitest";
import type { DiffCoverageResult } from "../src/diffCoverage.js";
import { buildReport, formatNumber, verdictOf } from "../src/report.js";
import { expectValidReport, validateReport } from "./schema.js";

const dc = (overrides: Partial<DiffCoverageResult> = {}): DiffCoverageResult => ({
  percent: 90,
  threshold: 80,
  coveredLines: 9,
  coverableLines: 10,
  files: [{ path: "a.ts", percent: 90, coveredLines: 9, coverableLines: 10, uncoveredLines: [3] }],
  meetsThreshold: true,
  ...overrides,
});
const setup = { files: [{ path: "CLAUDE.md", kind: "claude-md" as const }] };
const base = { version: "0.1.0", agentSetup: setup };

describe("buildReport", () => {
  it("passes above the threshold with no messages", () => {
    const report = buildReport({ ...base, threshold: 80, diffCoverage: dc() });
    expect(report.verdict).toBe("pass");
    expect(report.messages).toEqual([]);
    expect(report.diffCoverage).not.toHaveProperty("meetsThreshold");
    expectValidReport(report);
  });

  it("fails below the threshold", () => {
    const report = buildReport({
      ...base,
      threshold: 80,
      diffCoverage: dc({ percent: 66.67, coveredLines: 2, coverableLines: 3, meetsThreshold: false }),
    });
    expect(report.verdict).toBe("fail");
    expect(report.messages).toEqual([
      {
        level: "error",
        code: "DIFF_COVERAGE_BELOW_THRESHOLD",
        text: "Diff coverage 66.67% is below the threshold of 80%.",
      },
    ]);
    expectValidReport(report);
  });

  it("passes with NO_COVERABLE_CHANGES when nothing is coverable", () => {
    const report = buildReport({
      ...base,
      threshold: 80,
      diffCoverage: dc({ percent: null, coveredLines: 0, coverableLines: 0, files: [] }),
    });
    expect(report.verdict).toBe("pass");
    expect(report.messages.map((m) => [m.level, m.code])).toEqual([["info", "NO_COVERABLE_CHANGES"]]);
    expectValidReport(report);
  });

  it("fails when the coverage file is missing and a threshold is set", () => {
    const report = buildReport({
      ...base,
      threshold: 80,
      diffCoverage: null,
      missing: { reason: "coverage-file-missing", coverageFile: "coverage/lcov.info" },
    });
    expect(report.verdict).toBe("fail");
    expect(report.diffCoverage).toBeNull();
    expect(report.messages[0]).toEqual({
      level: "error",
      code: "COVERAGE_FILE_MISSING",
      text: "Coverage file not found: coverage/lcov.info",
    });
    expectValidReport(report);
  });

  it("only warns about a missing coverage file without a threshold", () => {
    const report = buildReport({
      ...base,
      threshold: null,
      diffCoverage: null,
      missing: { reason: "coverage-file-missing", coverageFile: "x" },
    });
    expect(report.verdict).toBe("warn");
    expectValidReport(report);
  });

  it("fails when the diff is unavailable and a threshold is set", () => {
    const report = buildReport({
      ...base,
      threshold: 80,
      diffCoverage: null,
      missing: { reason: "diff-unavailable", detail: "no base" },
    });
    expect(report.verdict).toBe("fail");
    expect(report.messages[0]?.code).toBe("DIFF_UNAVAILABLE");
    expect(report.messages[0]?.level).toBe("error");
    expectValidReport(report);
  });

  it("adds an info message when no agent setup files exist", () => {
    const report = buildReport({ version: "0.1.0", agentSetup: { files: [] }, threshold: null, diffCoverage: dc() });
    expect(report.verdict).toBe("pass");
    expect(report.messages.map((m) => m.code)).toEqual(["NO_AGENT_SETUP_FILES"]);
    expectValidReport(report);
  });
});

describe("verdictOf", () => {
  it("is fail > warn > pass", () => {
    expect(verdictOf([])).toBe("pass");
    expect(verdictOf([{ level: "info", code: "NO_COVERABLE_CHANGES", text: "x" }])).toBe("pass");
    expect(
      verdictOf([
        { level: "warn", code: "DIFF_UNAVAILABLE", text: "x" },
        { level: "info", code: "NO_COVERABLE_CHANGES", text: "x" },
      ]),
    ).toBe("warn");
    expect(
      verdictOf([
        { level: "warn", code: "DIFF_UNAVAILABLE", text: "x" },
        { level: "error", code: "COVERAGE_FILE_MISSING", text: "x" },
      ]),
    ).toBe("fail");
  });
});

describe("formatNumber", () => {
  it("drops needless decimals", () => {
    expect(formatNumber(80)).toBe("80");
    expect(formatNumber(66.67)).toBe("66.67");
    expect(formatNumber(72.5)).toBe("72.5");
  });
});

describe("schema", () => {
  it("rejects reports that break the contract", () => {
    const good = buildReport({ ...base, threshold: 80, diffCoverage: dc() });
    expect(validateReport(good)).toBe(true);
    expect(validateReport({ ...good, schemaVersion: "2" })).toBe(false);
    expect(validateReport({ ...good, verdict: "ok" })).toBe(false);
    expect(validateReport({ ...good, extra: true })).toBe(false);
    expect(validateReport({ ...good, messages: [{ level: "info", code: "lower_case", text: "x" }] })).toBe(false);
    const { agentSetup: _, ...missingField } = good;
    expect(validateReport(missingField)).toBe(false);
  });
});
