import { describe, expect, it } from "vitest";
import type { DiffCoverageResult } from "../src/diffCoverage.js";
import type { AgentSetupFile } from "../src/setup/scan.js";
import { expectValidReport } from "./schema.js";

// pr-comment-verdict-callout AC-3. buildReport() and the renderer are loaded inside the test body: the AC tests are
// written before the build, so nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const HEADING_PREFIX = "## \u{1F6E1}\u{FE0F} pharn-ci · ";

const MARKER = { pass: "> [!TIP]", warn: "> [!WARNING]", fail: "> [!CAUTION]" } as const;
const LABEL = { pass: "Pass", warn: "Warn", fail: "Fail" } as const;

const AGENTS: AgentSetupFile = { path: "AGENTS.md", kind: "agents-md" };

/** A change with no coverable added lines: the percent is null. */
const noCoverable: DiffCoverageResult = {
  percent: null,
  threshold: 80,
  coveredLines: 0,
  coverableLines: 0,
  files: [],
  meetsThreshold: true,
};

describe("renderMarkdown(): the verdict callout for a change with no coverable lines", () => {
  it("AC-3: the callout's content line carries the verdict label and the no-coverable-lines sentence", async () => {
    const { buildReport } = await import("../src/report.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const report = buildReport({
      version: "0.1.0",
      diffCoverage: noCoverable,
      threshold: 80,
      coverageFormat: "lcov",
      agentSetup: { files: [AGENTS] },
    });
    expectValidReport(report);
    expect(report.diffCoverage?.percent).toBeNull();

    const lines = renderMarkdown(report).split("\n");
    const at = lines.findIndex((line) => line.startsWith(HEADING_PREFIX));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toBe("");
    expect(lines[at + 2], "the alert marker").toBe(MARKER[report.verdict]);
    const content = lines[at + 3] ?? "";
    const prefix = `> **${LABEL[report.verdict]}** · This change adds no coverable lines; `;
    expect(content.startsWith(prefix), content).toBe(true);
  });
});
