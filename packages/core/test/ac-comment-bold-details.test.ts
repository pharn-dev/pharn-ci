import { describe, expect, it } from "vitest";
import type { DiffCoverageResult } from "../src/diffCoverage.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-bold-look AC-4. check(), buildReport() and the renderer are loaded inside the test body: the AC tests are
// written before the build, so nothing the build changes may run while the file loads.

const DIFF_TABLE_HEADER = "| File | Coverage | Covered | Uncovered lines |";
const SETUP_TABLE_HEADER = "| Path | Kind |";

async function goldenReport(): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
  });
  expectValidReport(report);
  return report;
}

/** A passing report: 3 changed files that meet a threshold of 80, and 2 agent setup files. */
async function passingReport(): Promise<Report> {
  const { buildReport } = await import("../src/report.js");
  const diffCoverage: DiffCoverageResult = {
    percent: 90,
    threshold: 80,
    coveredLines: 9,
    coverableLines: 10,
    files: [
      { path: "src/a.ts", percent: 100, coveredLines: 4, coverableLines: 4, uncoveredLines: [] },
      { path: "src/b.ts", percent: 75, coveredLines: 3, coverableLines: 4, uncoveredLines: [7] },
      { path: "src/c.ts", percent: 100, coveredLines: 2, coverableLines: 2, uncoveredLines: [] },
    ],
    meetsThreshold: true,
  };
  const report = buildReport({
    version: "0.1.0",
    diffCoverage,
    threshold: 80,
    coverageFormat: "lcov",
    agentSetup: {
      files: [
        { path: "AGENTS.md", kind: "agents-md" },
        { path: "CLAUDE.md", kind: "claude-md" },
      ],
    },
  });
  expectValidReport(report);
  return report;
}

interface Block {
  open: number;
  close: number;
}

/** Every `<details>` block, by the line of its opening tag and the line of its `</details>`. */
function detailsBlocks(lines: readonly string[]): Block[] {
  const stack: number[] = [];
  const blocks: Block[] = [];
  lines.forEach((line, index) => {
    if (/^<details( open)?>/.test(line)) stack.push(index);
    if (line.includes("</details>")) {
      const open = stack.pop();
      if (open !== undefined) blocks.push({ open, close: index });
    }
  });
  return blocks;
}

/** The innermost block a line sits inside, if any. */
function enclosing(blocks: readonly Block[], index: number): Block | undefined {
  return blocks.filter((block) => block.open < index && index < block.close).sort((a, b) => b.open - a.open)[0];
}

/** The first non-empty line after a block's opening tag. */
function summaryOf(lines: readonly string[], block: Block): string | undefined {
  return lines.slice(block.open + 1, block.close).find((line) => line.trim() !== "");
}

/** The non-empty lines of the Messages section: from its heading to the next heading. */
function messageLines(lines: readonly string[]): number[] {
  const start = lines.findIndex((line) => line.startsWith("### 💬 Messages ("));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("#"));
  const indexes: number[] = [];
  for (let index = start + 1; index < (end === -1 ? lines.length : end); index++) {
    if (lines[index]?.trim() !== "") indexes.push(index);
  }
  return indexes;
}

/** Asserts that the table whose header row is `header` sits in a block with this opening line and summary. */
function expectTableIn(lines: readonly string[], header: string, opening: string, summary: string, label: string) {
  const blocks = detailsBlocks(lines);
  const at = lines.indexOf(header);
  expect(at, `${label}: table header present`).toBeGreaterThan(-1);
  const block = enclosing(blocks, at);
  expect(block, `${label}: table inside a <details> block`).toBeDefined();
  if (block === undefined) return;
  expect(lines[block.open], `${label}: opening line`).toBe(opening);
  expect(summaryOf(lines, block), `${label}: summary line`).toBe(summary);
}

/** Asserts that the headline, the `Agent setup:` line and every message line sit outside every block. */
function expectVisible(lines: readonly string[], messages: number, label: string) {
  const blocks = detailsBlocks(lines);
  const headline = lines.findIndex((line) => line.includes("of changed lines covered"));
  const setup = lines.findIndex((line) => line.startsWith("Agent setup: "));
  expect(headline, `${label}: coverage headline present`).toBeGreaterThan(-1);
  expect(setup, `${label}: Agent setup line present`).toBeGreaterThan(-1);
  const shown = messageLines(lines);
  expect(shown.length, `${label}: message lines present`).toBeGreaterThanOrEqual(messages);
  for (const index of [headline, setup, ...shown]) {
    expect(enclosing(blocks, index), `${label}: outside <details>: ${lines[index]}`).toBeUndefined();
  }
}

describe("renderMarkdown(): per-file detail collapsed in <details> blocks", () => {
  it("AC-4: the file tables sit in <details> blocks, the diff one open below the threshold, and the summary lines and messages stay visible", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const golden = await goldenReport();
    expect(golden.messages.some((m) => m.code === "DIFF_COVERAGE_BELOW_THRESHOLD")).toBe(true);
    expect(golden.diffCoverage?.files).toHaveLength(3);
    expect(golden.agentSetup.files).toHaveLength(8);
    const goldenLines = renderMarkdown(golden).split("\n");
    expectTableIn(goldenLines, DIFF_TABLE_HEADER, "<details open>", "<summary>Changed files (3)</summary>", "golden");
    expectTableIn(goldenLines, SETUP_TABLE_HEADER, "<details>", "<summary>Agent setup files (8)</summary>", "golden");
    expectVisible(goldenLines, golden.messages.length, "golden");

    const passing = await passingReport();
    expect(passing.verdict).toBe("pass");
    expect(passing.messages.some((m) => m.code === "DIFF_COVERAGE_BELOW_THRESHOLD")).toBe(false);
    const passingLines = renderMarkdown(passing).split("\n");
    expectTableIn(passingLines, DIFF_TABLE_HEADER, "<details>", "<summary>Changed files (3)</summary>", "passing");
    expectTableIn(passingLines, SETUP_TABLE_HEADER, "<details>", "<summary>Agent setup files (2)</summary>", "passing");
    expectVisible(passingLines, passing.messages.length, "passing");
  });
});
