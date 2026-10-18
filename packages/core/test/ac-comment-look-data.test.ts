import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// AC test for pr-comment-redesign-2 (AC-7). Targets are imported inside the test body so the file loads before
// the build; one `it` for the AC. The expected report is the committed fixtures/golden/report.json, read here and
// never written by this test (no snapshot).

describe("PR comment look: report data unchanged (pr-comment-redesign-2)", () => {
  it("AC-7: check() on the golden inputs deep-equals the committed report.json, and the new look shows its values", async () => {
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
    expect(report).toEqual(JSON.parse(fixture("golden/report.json")));

    // The new look is presentation of that same data: its summary block shows the report's own values.
    const percent = report.diffCoverage?.percent;
    const threshold = report.diffCoverage?.threshold;
    expect(typeof percent).toBe("number");
    expect(typeof threshold).toBe("number");
    const count = report.agentSetup.files.length;

    const lines = renderMarkdown(report).split("\n");
    const heading = lines.findIndex((l) => l.trim() !== "");
    const diffSection = lines.indexOf("### 🧪 Diff coverage");
    expect(diffSection).toBeGreaterThan(heading);
    const block = lines.slice(heading + 1, diffSection).join("\n");
    expect(block).toContain(`${percent}%`);
    expect(block).toContain(`${threshold}%`);
    expect(block).toContain(`${count} file${count === 1 ? "" : "s"}`);
  });
});
