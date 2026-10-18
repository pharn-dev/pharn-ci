import { describe, expect, it } from "vitest";
import type { DiffCoverageResult } from "../src/diffCoverage.js";
import type { BuildReportInput, Report } from "../src/report.js";
import type { AgentSetupFile } from "../src/setup/scan.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-bold-look AC-5. check(), buildReport() and the renderer are loaded inside the test body: the AC tests are
// written before the build, so nothing the build changes may run while the file loads.

const AGENTS: AgentSetupFile = { path: "AGENTS.md", kind: "agents-md" };
const CLAUDE: AgentSetupFile = { path: "CLAUDE.md", kind: "claude-md" };

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

/** Diff coverage of `files.length` changed files, each with `covered` of `coverable` added lines covered. */
function measured(threshold: number | null, files: readonly (readonly [number, number])[]): DiffCoverageResult {
  const coveredLines = files.reduce((sum, [covered]) => sum + covered, 0);
  const coverableLines = files.reduce((sum, [, coverable]) => sum + coverable, 0);
  const pct = (covered: number, coverable: number) =>
    coverable === 0 ? null : Math.round((covered / coverable) * 10_000) / 100;
  return {
    percent: pct(coveredLines, coverableLines),
    threshold,
    coveredLines,
    coverableLines,
    files: files.map(([covered, coverable], i) => ({
      path: `src/f${i}.ts`,
      percent: pct(covered, coverable),
      coveredLines: covered,
      coverableLines: coverable,
      uncoveredLines: Array.from({ length: coverable - covered }, (_, n) => n + 1),
    })),
    meetsThreshold: threshold === null || coverableLines === 0 || (coveredLines / coverableLines) * 100 >= threshold,
  };
}

/** A buildReport report; `withFormat: false` leaves `coverageFormat` out, so `diffCoverage.format` is absent. */
async function build(input: Partial<BuildReportInput>, withFormat = true): Promise<Report> {
  const { buildReport } = await import("../src/report.js");
  const report = buildReport({
    version: "0.1.0",
    diffCoverage: measured(80, [[2, 2]]),
    threshold: 80,
    ...(withFormat ? { coverageFormat: "lcov" as const } : {}),
    agentSetup: { files: [AGENTS] },
    ...input,
  });
  expectValidReport(report);
  return report;
}

/** The reports of AC-1 to AC-4, rebuilt here: the golden report and the buildReport variants those criteria name. */
async function earlierReports(): Promise<Report[]> {
  return [
    await goldenReport(),
    await build({}),
    await build({ diffCoverage: measured(null, [[2, 2]]), threshold: null, changedConfigPaths: [".pharn/ci.yml"] }),
    await build({ diffCoverage: null, missing: { reason: "diff-unavailable", detail: "no merge base" } }),
    await build({ diffCoverage: measured(80, []) }),
    await build({ diffCoverage: measured(null, [[1, 2]]), threshold: null }),
    await build({ agentSetup: { files: [] } }),
    await build({ agentSetup: { files: [CLAUDE] } }),
    await build({
      diffCoverage: measured(80, [
        [4, 4],
        [3, 4],
        [2, 2],
      ]),
      agentSetup: { files: [AGENTS, CLAUDE] },
    }),
  ];
}

describe("renderMarkdown(): the footer", () => {
  it("AC-5: ends with a thematic break and a footer naming the version, the schema and the coverage format, and carries no image or URL", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const golden = await goldenReport();
    expect(golden.diffCoverage?.format).toBe("lcov");
    const notComputed = await build({
      diffCoverage: null,
      missing: { reason: "diff-unavailable", detail: "no merge base" },
    });
    expect(notComputed.diffCoverage).toBeNull();
    const noFormat = await build({}, false);
    expect(noFormat.diffCoverage).not.toBeNull();
    expect(noFormat.diffCoverage && "format" in noFormat.diffCoverage).toBe(false);

    const cases: [string, Report, string][] = [
      ["golden", golden, "<sub>pharn-ci 0.1.0 · report schema v1 · coverage format lcov</sub>"],
      ["diff coverage not computed", notComputed, "<sub>pharn-ci 0.1.0 · report schema v1</sub>"],
      ["no coverage format", noFormat, "<sub>pharn-ci 0.1.0 · report schema v1</sub>"],
    ];
    for (const [label, report, footer] of cases) {
      expect(report.tool.version, label).toBe("0.1.0");
      const lines = renderMarkdown(report).split("\n");
      const nonEmpty = lines.filter((line) => line.trim() !== "");
      expect(nonEmpty.slice(-2), label).toEqual(["---", footer]);
      const rule = lines.lastIndexOf("---");
      expect(rule, `${label}: thematic break present`).toBeGreaterThan(0);
      expect(lines[rule - 1], `${label}: empty line before ---`).toBe("");
    }

    // The one allowed image is the fixed logo line (line 1); every banned string is still banned in the rest.
    const { logoMarkup } = await import("../src/render/logo.js");
    const renderings = [...(await earlierReports()), notComputed, noFormat].map((report) => {
      const [first, ...rest] = renderMarkdown(report).split("\n");
      expect(first).toBe(logoMarkup());
      return rest.join("\n");
    });
    for (const markdown of renderings) {
      for (const banned of ["<img", "![", "http://", "https://"]) {
        expect(markdown).not.toContain(banned);
      }
    }
  });
});
