import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// AC test for pr-comment-redesign-2 (AC-2). Targets are imported inside the test body so the file loads before
// the build; one `it` for the AC. No snapshot: the expected values are written inline.

/** The text between the verdict heading (first non-empty line) and the `### 🧪 Diff coverage` heading. */
function summaryBlock(md: string): string {
  const lines = md.split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  const diffSection = lines.indexOf("### 🧪 Diff coverage");
  expect(lines[first]).toMatch(/^## 🛡️ pharn-ci · \S+ (Pass|Warn|Fail)$/);
  expect(diffSection).toBeGreaterThan(first);
  return lines.slice(first + 1, diffSection).join("\n");
}

describe("PR comment look: summary block edge states (pr-comment-redesign-2)", () => {
  it("AC-2: shows not computed, no coverable lines, no threshold, none and 1 file", async () => {
    const { buildReport } = await import("../src/report.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const agents = [{ path: "AGENTS.md", kind: "agents-md" }] as never;

    const notComputed = buildReport({
      version: "0.1.0",
      threshold: 80,
      diffCoverage: null,
      missing: { reason: "coverage-file-missing", coverageFile: "coverage/lcov.info" },
      agentSetup: { files: agents },
    });
    const noCoverable = buildReport({
      version: "0.1.0",
      threshold: 80,
      diffCoverage: {
        percent: null,
        threshold: 80,
        coveredLines: 0,
        coverableLines: 0,
        files: [],
        meetsThreshold: true,
      },
      agentSetup: { files: agents },
    });
    const noThreshold = buildReport({
      version: "0.1.0",
      threshold: null,
      diffCoverage: {
        percent: 50,
        threshold: null,
        coveredLines: 1,
        coverableLines: 2,
        files: [{ path: "src/a.ts", percent: 50, coveredLines: 1, coverableLines: 2, uncoveredLines: [2] }],
        meetsThreshold: true,
      },
      agentSetup: { files: agents },
    });
    const noSetup = buildReport({
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
      agentSetup: { files: [] },
    });
    const oneSetup = buildReport({
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
      agentSetup: { files: agents },
    });

    const cases = [
      [notComputed, "not computed"],
      [noCoverable, "no coverable lines"],
      [noThreshold, "no threshold"],
      [noSetup, "none"],
    ] as const;
    for (const [report, shown] of cases) {
      expectValidReport(report);
      expect(summaryBlock(renderMarkdown(report)), shown).toContain(shown);
    }

    expectValidReport(oneSetup);
    expect(oneSetup.agentSetup.files).toHaveLength(1);
    // "1 file", not "1 files" or "11 files".
    expect(summaryBlock(renderMarkdown(oneSetup))).toMatch(/(^|[^\d])1 file\b/);
  });
});
