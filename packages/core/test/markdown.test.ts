import { describe, expect, it } from "vitest";
import { formatRanges, renderMarkdown } from "../src/render/markdown.js";
import { buildReport } from "../src/report.js";

describe("formatRanges", () => {
  it("collapses consecutive lines", () => {
    expect(formatRanges([])).toBe("");
    expect(formatRanges([5])).toBe("5");
    expect(formatRanges([1, 2, 3, 7, 9, 10])).toBe("1-3, 7, 9-10");
  });
});

describe("renderMarkdown", () => {
  it("renders the not-computed state", () => {
    const report = buildReport({
      version: "0.1.0",
      threshold: 80,
      diffCoverage: null,
      missing: { reason: "coverage-file-missing", coverageFile: "coverage/lcov.info" },
      agentSetup: { files: [] },
    });
    expect(renderMarkdown(report)).toMatchSnapshot();
  });

  it("renders the no-coverable-changes state", () => {
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
    expect(renderMarkdown(report)).toMatchSnapshot();
  });

  it("truncates long tables and escapes paths", () => {
    const files = Array.from({ length: 4 }, (_, i) => ({
      path: `src/a|b\`${i}.ts`,
      percent: 100,
      coveredLines: 1,
      coverableLines: 1,
      uncoveredLines: [],
    }));
    const report = buildReport({
      version: "0.1.0",
      threshold: null,
      diffCoverage: { percent: 100, threshold: null, coveredLines: 4, coverableLines: 4, files, meetsThreshold: true },
      agentSetup: { files: [] },
    });
    const md = renderMarkdown(report, { maxRows: 2 });
    expect(md).toContain("| `src/a\\|b'0.ts` | 100% | 1/1 |  |");
    expect(md).toContain("_…and 2 more files_");
    expect(md).not.toContain("b'2.ts");
  });
});
