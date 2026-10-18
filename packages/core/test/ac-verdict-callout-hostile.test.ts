import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-verdict-callout AC-4. check() and the renderer are loaded inside the test body: the AC tests are written
// before the build, so nothing the build changes may run while the file loads.

const MARKER = { pass: "> [!TIP]", warn: "> [!WARNING]", fail: "> [!CAUTION]" } as const;
/** The callout's content line: a fixed label and a sentence of fixed words, numbers and counts only. */
const CONTENT = /^> \*\*(Pass|Warn|Fail)\*\* · [A-Za-z0-9 .,;%]+$/;

interface Hostile {
  repoFiles: string[];
  coverageFile: string;
  baseRef: string;
}

/** Reports built by check() from the PR-controlled inputs of fixtures/render/hostile-paths.json. */
async function hostileReports(): Promise<Report[]> {
  const { check } = await import("../src/check.js");
  const hostile = JSON.parse(fixture("render/hostile-paths.json")) as Hostile;
  const reports = [
    // A missing coverage file whose path is hostile, with hostile tracked paths.
    check({
      version: "0.1.0",
      coverage: { missingFile: hostile.coverageFile },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: hostile.repoFiles,
    }),
    // An unavailable diff whose detail carries the hostile base ref.
    check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { unavailable: hostile.baseRef },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: [...fixture("golden/files.txt").trim().split("\n"), ...hostile.repoFiles],
    }),
  ];
  for (const report of reports) expectValidReport(report);
  return reports;
}

describe("renderMarkdown(): the verdict callout carries no input-derived text", () => {
  it("AC-4: a hostile rendering has exactly two lines starting with >, the alert marker and a fixed-text content line", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const reports = await hostileReports();
    expect(reports).toHaveLength(2);

    for (const report of reports) {
      const quoted = renderMarkdown(report)
        .split("\n")
        .filter((line) => line.startsWith(">"));
      expect(quoted, `${report.verdict}: lines starting with >`).toHaveLength(2);
      expect(quoted[0], `${report.verdict}: the alert marker`).toBe(MARKER[report.verdict]);
      expect(quoted[1] ?? "", `${report.verdict}: the content line`).toMatch(CONTENT);
    }
  });
});
