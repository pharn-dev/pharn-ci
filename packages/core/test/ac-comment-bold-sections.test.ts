import { describe, expect, it } from "vitest";
import type { DiffCoverageResult } from "../src/diffCoverage.js";
import type { BuildReportInput, Report } from "../src/report.js";
import type { AgentSetupFile } from "../src/setup/scan.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-bold-look AC-3. check(), buildReport() and the renderer are loaded inside the test body: the AC tests are
// written before the build, so nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const SHIELD = "\u{1F6E1}️";
const DOT = "·";
const HEADING_PREFIX = `## ${SHIELD} pharn-ci ${DOT} `;

const AGENTS: AgentSetupFile = { path: "AGENTS.md", kind: "agents-md" };

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

/** Diff coverage that meets a threshold of 80: one file, both added lines covered. */
const met: DiffCoverageResult = {
  percent: 100,
  threshold: 80,
  coveredLines: 2,
  coverableLines: 2,
  files: [{ path: "src/a.ts", percent: 100, coveredLines: 2, coverableLines: 2, uncoveredLines: [] }],
  meetsThreshold: true,
};

async function build(input: Partial<BuildReportInput>): Promise<Report> {
  const { buildReport } = await import("../src/report.js");
  const report = buildReport({
    version: "0.1.0",
    diffCoverage: met,
    threshold: 80,
    coverageFormat: "lcov",
    agentSetup: { files: [AGENTS] },
    ...input,
  });
  expectValidReport(report);
  return report;
}

async function lines(report: Report): Promise<string[]> {
  const { renderMarkdown } = await import("../src/render/markdown.js");
  return renderMarkdown(report).split("\n");
}

describe("renderMarkdown(): emoji section headings with counts", () => {
  it("AC-3: the sections are Diff coverage, Messages (N) and Agent setup (N files), in that order, with no other heading", async () => {
    const golden = await goldenReport();
    expect(golden.messages).toHaveLength(2);
    expect(golden.agentSetup.files).toHaveLength(8);
    const goldenLines = await lines(golden);

    const sections = ["### 🧪 Diff coverage", "### 💬 Messages (2)", "### 🤖 Agent setup (8 files)"];
    const at = sections.map((section) => goldenLines.indexOf(section));
    for (const [i, section] of sections.entries()) {
      expect(at[i], `present: ${section}`).toBeGreaterThan(-1);
    }
    expect(at).toEqual([...at].sort((a, b) => a - b));

    // Every line that starts a heading: the header heading, then the three sections, and nothing else.
    const headings = goldenLines.filter((line) => line.startsWith("#"));
    expect(headings).toHaveLength(4);
    expect(headings[0]?.startsWith(HEADING_PREFIX), headings[0]).toBe(true);
    expect(headings.slice(1)).toEqual(sections);

    // No messages: no Messages section at all.
    const quiet = await build({});
    expect(quiet.messages).toHaveLength(0);
    const quietLines = await lines(quiet);
    expect(quietLines.filter((line) => line.startsWith("### 💬 Messages"))).toEqual([]);
    expect(quietLines).toContain("### 🤖 Agent setup (1 file)");

    // The agent setup count reads "no files" and "1 file".
    const none = await build({ agentSetup: { files: [] } });
    expect(none.agentSetup.files).toHaveLength(0);
    expect(await lines(none)).toContain("### 🤖 Agent setup (no files)");

    const one = await build({ agentSetup: { files: [{ path: "CLAUDE.md", kind: "claude-md" }] } });
    expect(one.agentSetup.files).toHaveLength(1);
    expect(await lines(one)).toContain("### 🤖 Agent setup (1 file)");
  });
});
