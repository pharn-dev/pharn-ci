import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// AC test for pr-comment-redesign-2 (AC-1). Targets are imported inside the test body so the file loads before
// the build; one `it` for the AC. No snapshot: the expected values are written inline.

describe("PR comment look: verdict header and summary block (pr-comment-redesign-2)", () => {
  it("AC-1: opens with the verdict header and a summary block before the diff coverage section", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(report);
    // The Given: fail, 71.43% (5 of 7), threshold 80%, 8 agent setup files.
    expect(report.verdict).toBe("fail");
    expect(report.diffCoverage?.percent).toBe(71.43);
    expect(report.diffCoverage?.coveredLines).toBe(5);
    expect(report.diffCoverage?.coverableLines).toBe(7);
    expect(report.diffCoverage?.threshold).toBe(80);
    expect(report.agentSetup.files).toHaveLength(8);

    const lines = renderMarkdown(report).split("\n");
    // The heading follows the fixed logo block (the logo line and an empty line).
    const first = lines.findIndex((l) => l.startsWith("## "));
    expect(first).toBe(2);
    expect(lines[first]).toBe("## 🛡️ pharn-ci · ❌ Fail");

    const diffSection = lines.indexOf("### 🧪 Diff coverage");
    expect(diffSection).toBeGreaterThan(first);
    const block = lines.slice(first + 1, diffSection).join("\n");
    for (const shown of ["Fail", "71.43%", "80%", "8 files"]) {
      expect(block, `summary block shows ${shown}`).toContain(shown);
    }
  });
});
