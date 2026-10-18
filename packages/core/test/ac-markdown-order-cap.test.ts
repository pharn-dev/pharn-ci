import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// AC test for f16-comment-truncation (AC-1). The targets are imported inside the test body so the file loads
// before the build; one `it` for the AC. No snapshot: the expected values are written inline.

type CoverageFile = {
  path: string;
  percent: number | null;
  coveredLines: number;
  coverableLines: number;
  uncoveredLines: number[];
};

/** `count` uncovered lines that form `count` separate one-line ranges: 1, 3, 5, ... */
function separateLines(count: number): number[] {
  return Array.from({ length: count }, (_, i) => 2 * i + 1);
}

function fileWithRanges(path: string, ranges: number): CoverageFile {
  const uncovered = separateLines(ranges);
  return {
    path,
    percent: 50,
    coveredLines: uncovered.length,
    coverableLines: uncovered.length * 2,
    uncoveredLines: uncovered,
  };
}

/** The Uncovered lines cell (last column) of the diff coverage row for `path`. */
function uncoveredCell(md: string, path: string): string {
  const row = md.split("\n").find((line) => line.startsWith(`| \`${path}\` |`));
  if (row === undefined) throw new Error(`no diff coverage row for ${path}`);
  const cells = row.slice(1, -1).split(" | ");
  return (cells.at(-1) ?? "").trim();
}

describe("markdown section order and capped uncovered-lines cell (f16-comment-truncation)", () => {
  it("AC-1: renders Messages before Agent setup and caps the uncovered-lines cell at 20 ranges", async () => {
    const { buildReport } = await import("../src/report.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const fifty = fileWithRanges("src/fifty.ts", 50);
    const twenty = fileWithRanges("src/twenty.ts", 20);
    const covered = fifty.coveredLines + twenty.coveredLines;
    const coverable = fifty.coverableLines + twenty.coverableLines;
    const report = buildReport({
      version: "0.1.0",
      threshold: 80,
      diffCoverage: {
        percent: 50,
        threshold: 80,
        coveredLines: covered,
        coverableLines: coverable,
        files: [fifty, twenty],
        meetsThreshold: false,
      },
      agentSetup: {
        files: [
          { path: "AGENTS.md", kind: "agents-md" },
          { path: "CLAUDE.md", kind: "claude-md" },
        ] as never,
      },
    });
    expectValidReport(report);
    expect(report.messages.length).toBeGreaterThan(0);
    expect(report.agentSetup.files.length).toBeGreaterThan(0);

    const md = renderMarkdown(report);
    const lines = md.split("\n");

    // Section order: the reason for the verdict comes before the inventory.
    const messages = lines.indexOf("### Messages");
    const setup = lines.indexOf("### Agent setup");
    expect(messages).toBeGreaterThanOrEqual(0);
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(messages).toBeLessThan(setup);

    // 50 separate ranges: the first 20, then a count of the 30 ranges not shown.
    const first20 = separateLines(20).map(String).join(", ");
    expect(uncoveredCell(md, "src/fifty.ts")).toBe(`${first20}, …and 30 more`);

    // Exactly 20 ranges: all of them, no count.
    const twentyCell = uncoveredCell(md, "src/twenty.ts");
    expect(twentyCell).toBe(first20);
    expect(twentyCell).not.toContain("more");
  });
});
