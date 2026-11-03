import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render/markdown.js";
import { buildReport } from "../src/report.js";
import { expectValidReport } from "./schema.js";

// The diff-coverage bar: 20 cells of `▰` (covered) and `▱` (not covered), the filled count rounded and clamped, on its
// own line above the "**N%** of changed lines covered" line, followed by the percentage.

const CELLS = 20;

/** A report whose diff coverage is coveredLines of coverableLines at the given percent, with an 80% threshold. */
function reportAt(percent: number, coveredLines: number, coverableLines: number) {
  const report = buildReport({
    version: "0.1.0",
    threshold: 80,
    diffCoverage: {
      percent,
      threshold: 80,
      coveredLines,
      coverableLines,
      files: [],
      meetsThreshold: percent >= 80,
    },
    agentSetup: { files: [{ path: "AGENTS.md", kind: "agents-md" }] },
  });
  expectValidReport(report);
  return report;
}

/** The bar line and the lines around it in the rendered Diff coverage section. */
function barOf(markdown: string): { bar: string; before: string; after: string[] } {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => /^`[▰▱]+` /.test(l));
  expect(at, "a bar line").toBeGreaterThan(-1);
  return { bar: lines[at] as string, before: lines[at - 1] as string, after: lines.slice(at + 1, at + 3) };
}

const bar = (filled: number) => `\`${"▰".repeat(filled)}${"▱".repeat(CELLS - filled)}\``;

describe("renderMarkdown: the diff-coverage bar", () => {
  it("0% is 20 empty cells", () => {
    const { bar: line } = barOf(renderMarkdown(reportAt(0, 0, 5)));
    expect(line).toBe(`\`${"▱".repeat(20)}\` 0%`);
  });

  it("100% is 20 filled cells", () => {
    const { bar: line } = barOf(renderMarkdown(reportAt(100, 4, 4)));
    expect(line).toBe(`\`${"▰".repeat(20)}\` 100%`);
  });

  it("71.43% is 14 filled and 6 empty cells, above the percentage line", () => {
    const { bar: line, before, after } = barOf(renderMarkdown(reportAt(71.43, 5, 7)));
    expect(line).toBe(`\`${"▰".repeat(14)}${"▱".repeat(6)}\` 71.43%`);
    expect(before).toBe("");
    expect(after).toEqual(["", "**71.43%** of changed lines covered (5/7, threshold 80%)"]);
  });

  it("2.4% rounds down to no filled cell", () => {
    const { bar: line } = barOf(renderMarkdown(reportAt(2.4, 3, 125)));
    expect(line).toBe(`${bar(0)} 2.4%`);
  });

  it("has no bar when no coverable lines changed", () => {
    const report = buildReport({
      version: "0.1.0",
      threshold: null,
      diffCoverage: {
        percent: null,
        threshold: null,
        coveredLines: 0,
        coverableLines: 0,
        files: [],
        meetsThreshold: true,
      },
      agentSetup: { files: [{ path: "AGENTS.md", kind: "agents-md" }] },
    });
    expectValidReport(report);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("_No coverable lines changed._");
    expect(markdown).not.toMatch(/[▰▱]/);
  });

  it("has no bar when diff coverage is missing", () => {
    const report = buildReport({
      version: "0.1.0",
      threshold: 80,
      diffCoverage: null,
      missing: { reason: "coverage-file-missing", coverageFile: "coverage/lcov.info" },
      agentSetup: { files: [] },
    });
    expectValidReport(report);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("_Not computed — see messages below._");
    expect(markdown).not.toMatch(/[▰▱]/);
  });
});
