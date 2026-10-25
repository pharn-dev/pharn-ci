import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-bold-look AC-1. check() and the renderer are loaded inside the test body: the AC tests are written before
// the build, so nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const SHIELD = "\u{1F6E1}️";
const DOT = "·";

async function goldenReport() {
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

describe("renderMarkdown(): the branded header block", () => {
  it("AC-1: opens with the brand and verdict heading, the overview sentence and the summary table, above Diff coverage", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const report = await goldenReport();
    // The golden inputs are what the criterion describes.
    expect(report.verdict).toBe("fail");
    expect(report.diffCoverage?.percent).toBe(71.43);
    expect(report.diffCoverage?.coveredLines).toBe(5);
    expect(report.diffCoverage?.coverableLines).toBe(7);
    expect(report.diffCoverage?.threshold).toBe(80);
    expect(report.diffCoverage?.format).toBe("lcov");
    expect(report.agentSetup.files).toHaveLength(8);
    expect(report.messages).toHaveLength(2);

    const lines = renderMarkdown(report).split("\n");
    const heading = `## ${SHIELD} pharn-ci ${DOT} ❌ Fail`;
    const overview = "Diff coverage of this change is 71.43% against a threshold of 80%; 8 agent setup files found.";
    const tableHeader = "| Verdict | Diff coverage | Test integrity | Agent setup |";
    const valueRow = "| ❌ Fail | 71.43% (threshold 80%) | none (warn) | 8 files |";
    // pr-comment-verdict-callout put the overview sentence in a callout under the heading on purpose.
    const marker = "> [!CAUTION]";
    const callout = `> **Fail** ${DOT} ${overview}`;

    // The first non-empty line is the fixed logo line; the next four are the heading, the callout and the table header.
    const { logoMarkup } = await import("../src/render/logo.js");
    expect(lines.filter((line) => line.trim() !== "").slice(0, 5)).toEqual([
      logoMarkup(),
      heading,
      marker,
      callout,
      tableHeader,
    ]);

    const section = lines.indexOf("### 🧪 Diff coverage");
    expect(section, "the Diff coverage section heading").toBeGreaterThan(-1);
    for (const line of [heading, callout, tableHeader, valueRow]) {
      const at = lines.indexOf(line);
      expect(at, `present: ${line}`).toBeGreaterThan(-1);
      expect(at, `above Diff coverage: ${line}`).toBeLessThan(section);
    }
  });
});
