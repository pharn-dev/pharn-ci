import { describe, expect, it } from "vitest";
import type { DiffCoverageResult } from "../src/diffCoverage.js";
import type { BuildReportInput, Report } from "../src/report.js";
import type { AgentSetupFile } from "../src/setup/scan.js";
import { expectValidReport } from "./schema.js";

// pr-comment-verdict-callout AC-2. buildReport() and the renderer are loaded inside the test body: the AC tests are
// written before the build, so nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const HEADING_PREFIX = "## \u{1F6E1}\u{FE0F} pharn-ci · ";
const TABLE_HEADER = "| Verdict | Diff coverage | Test integrity | Agent setup |";

const AGENTS: AgentSetupFile = { path: "AGENTS.md", kind: "agents-md" };
const CLAUDE: AgentSetupFile = { path: "CLAUDE.md", kind: "claude-md" };

/** 2 of 2 added lines covered, against a threshold of 80. */
const full: DiffCoverageResult = {
  percent: 100,
  threshold: 80,
  coveredLines: 2,
  coverableLines: 2,
  files: [{ path: "src/a.ts", percent: 100, coveredLines: 2, coverableLines: 2, uncoveredLines: [] }],
  meetsThreshold: true,
};

/** 2 of 4 added lines covered, with no threshold set. */
const half: DiffCoverageResult = {
  percent: 50,
  threshold: null,
  coveredLines: 2,
  coverableLines: 4,
  files: [{ path: "src/a.ts", percent: 50, coveredLines: 2, coverableLines: 4, uncoveredLines: [3, 4] }],
  meetsThreshold: true,
};

async function build(input: Omit<BuildReportInput, "version" | "coverageFormat">): Promise<Report> {
  const { buildReport } = await import("../src/report.js");
  const report = buildReport({ version: "0.1.0", coverageFormat: "lcov", ...input });
  expectValidReport(report);
  return report;
}

describe("renderMarkdown(): the verdict callout under the heading", () => {
  it("AC-2: pass, warn and fail reports each open with their alert marker and the labelled overview sentence", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const pass = await build({ diffCoverage: full, threshold: 80, agentSetup: { files: [AGENTS] } });
    const warn = await build({
      diffCoverage: null,
      threshold: null,
      missing: { reason: "diff-unavailable", detail: "no merge base" },
      agentSetup: { files: [] },
    });
    // Fail through a required, expected tool that neither setup file configures (AGENTS.md already configures cursor,
    // so the expected tool is windsurf): AGENT_SETUP_EXPECTED_MISSING is then an error.
    const fail = await build({
      diffCoverage: half,
      threshold: null,
      agentSetup: { files: [AGENTS, CLAUDE] },
      expectedAgentTools: ["windsurf"],
      requireAgentSetup: true,
    });

    const cases = [
      [
        pass,
        "pass",
        "> [!TIP]",
        "> **Pass** · Diff coverage of this change is 100% against a threshold of 80%; 1 agent setup file found.",
      ],
      [warn, "warn", "> [!WARNING]", "> **Warn** · Diff coverage was not computed; no agent setup files found."],
      [
        fail,
        "fail",
        "> [!CAUTION]",
        "> **Fail** · Diff coverage of this change is 50%, with no threshold set; 2 agent setup files found.",
      ],
    ] as const;

    for (const [report, verdict, marker, content] of cases) {
      expect(report.verdict, verdict).toBe(verdict);
      const lines = renderMarkdown(report).split("\n");
      const at = lines.findIndex((line) => line.startsWith(HEADING_PREFIX));
      expect(at, `${verdict}: the heading`).toBeGreaterThanOrEqual(0);
      expect(lines.slice(at + 1, at + 6), `${verdict}: the lines after the heading`).toEqual([
        "",
        marker,
        content,
        "",
        TABLE_HEADER,
      ]);
    }
  });
});
