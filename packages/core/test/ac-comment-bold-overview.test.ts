import { describe, expect, it } from "vitest";
import type { DiffCoverageResult } from "../src/diffCoverage.js";
import type { BuildReportInput, Report } from "../src/report.js";
import type { AgentSetupFile } from "../src/setup/scan.js";
import { expectValidReport } from "./schema.js";

// pr-comment-bold-look AC-2. buildReport() and the renderer are loaded inside each test body: the AC tests are written
// before the build, so nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark; U+26A0 U+FE0F, the warn icon; U+00B7, the separator; as the SPEC writes them. */
const SHIELD = "\u{1F6E1}️";
const WARN = "⚠️";
const DOT = "·";

const AGENTS: AgentSetupFile = { path: "AGENTS.md", kind: "agents-md" };
const CLAUDE: AgentSetupFile = { path: "CLAUDE.md", kind: "claude-md" };

/** Diff coverage of one file with `covered` of `coverable` added lines covered. */
function measured(threshold: number | null, covered: number, coverable: number): DiffCoverageResult {
  const percent = coverable === 0 ? null : Math.round((covered / coverable) * 10_000) / 100;
  const uncoveredLines = Array.from({ length: coverable - covered }, (_, i) => i + 1);
  return {
    percent,
    threshold,
    coveredLines: covered,
    coverableLines: coverable,
    files:
      coverable === 0
        ? []
        : [{ path: "src/a.ts", percent, coveredLines: covered, coverableLines: coverable, uncoveredLines }],
    meetsThreshold: threshold === null || coverable === 0 || (covered / coverable) * 100 >= threshold,
  };
}

async function build(input: Partial<BuildReportInput>): Promise<Report> {
  const { buildReport } = await import("../src/report.js");
  const report = buildReport({
    version: "0.1.0",
    diffCoverage: measured(80, 2, 2),
    threshold: 80,
    coverageFormat: "lcov",
    agentSetup: { files: [AGENTS] },
    ...input,
  });
  expectValidReport(report);
  return report;
}

/** The heading and the overview sentence: the first two non-empty lines after the fixed logo line. */
async function header(report: Report): Promise<{ heading: string; overview: string }> {
  const { renderMarkdown } = await import("../src/render/markdown.js");
  const { logoMarkup } = await import("../src/render/logo.js");
  const [logo, ...rest] = renderMarkdown(report).split("\n");
  expect(logo).toBe(logoMarkup());
  const [heading = "", overview = ""] = rest.filter((line) => line.trim() !== "");
  return { heading, overview };
}

describe("renderMarkdown(): the heading and the overview sentence", () => {
  it("AC-2: a passing report has the Pass heading", async () => {
    const report = await build({});
    expect(report.verdict).toBe("pass");
    const { heading, overview } = await header(report);
    expect(heading).toBe(`## ${SHIELD} pharn-ci ${DOT} ✅ Pass`);
    expect(overview).toBe("Diff coverage of this change is 100% against a threshold of 80%; 1 agent setup file found.");
  });

  it("AC-2: a warning report has the Warn heading", async () => {
    const report = await build({
      diffCoverage: measured(null, 2, 2),
      threshold: null,
      changedConfigPaths: [".pharn/ci.yml"],
    });
    expect(report.verdict).toBe("warn");
    const { heading } = await header(report);
    expect(heading).toBe(`## ${SHIELD} pharn-ci ${DOT} ${WARN} Warn`);
  });

  it("AC-2: diff coverage not computed starts the sentence with 'Diff coverage was not computed;'", async () => {
    const report = await build({
      diffCoverage: null,
      missing: { reason: "diff-unavailable", detail: "no merge base" },
    });
    expect(report.diffCoverage).toBeNull();
    const { overview } = await header(report);
    expect(overview.startsWith("Diff coverage was not computed;"), overview).toBe(true);
    expect(overview).toBe("Diff coverage was not computed; 1 agent setup file found.");
  });

  it("AC-2: no coverable changed lines starts the sentence with 'This change adds no coverable lines;'", async () => {
    const report = await build({ diffCoverage: measured(80, 0, 0) });
    expect(report.diffCoverage?.percent).toBeNull();
    const { overview } = await header(report);
    expect(overview.startsWith("This change adds no coverable lines;"), overview).toBe(true);
  });

  it("AC-2: no threshold puts ', with no threshold set;' in the sentence", async () => {
    const report = await build({ diffCoverage: measured(null, 1, 2), threshold: null });
    expect(report.diffCoverage?.threshold).toBeNull();
    expect(report.diffCoverage?.percent).toBe(50);
    const { overview } = await header(report);
    expect(overview).toContain(", with no threshold set;");
    expect(overview).toBe("Diff coverage of this change is 50%, with no threshold set; 1 agent setup file found.");
  });

  it("AC-2: no agent setup files ends the sentence with '; no agent setup files found.'", async () => {
    const report = await build({ agentSetup: { files: [] } });
    expect(report.agentSetup.files).toHaveLength(0);
    const { overview } = await header(report);
    expect(overview.endsWith("; no agent setup files found."), overview).toBe(true);
  });

  it("AC-2: one agent setup file ends the sentence with '; 1 agent setup file found.'", async () => {
    const report = await build({ agentSetup: { files: [CLAUDE] } });
    expect(report.agentSetup.files).toHaveLength(1);
    const { overview } = await header(report);
    expect(overview.endsWith("; 1 agent setup file found."), overview).toBe(true);
  });
});
