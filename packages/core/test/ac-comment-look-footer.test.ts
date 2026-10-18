import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// AC test for pr-comment-redesign-2 (AC-4). Targets are imported inside the test body so the file loads before
// the build; one `it` for the AC. No snapshot: the expected values are written inline.

describe("PR comment look: compact footer and no image (pr-comment-redesign-2)", () => {
  it("AC-4: ends with the <sub> footer and carries no image or URL, with only the fixed logo line", async () => {
    const { check } = await import("../src/check.js");
    const { buildReport } = await import("../src/report.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const { logoMarkup } = await import("../src/render/logo.js");

    // The one place the header's logo markup comes from renders the fixed pharn logo line (pr-comment-logo-2).
    const LOGO =
      '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';
    expect(logoMarkup()).toBe(LOGO);

    const agents = [{ path: "AGENTS.md", kind: "agents-md" }] as never;
    const empty = { coveredLines: 0, coverableLines: 0, files: [], meetsThreshold: true };
    const files30 = Array.from({ length: 30 }, (_, i) => ({
      path: `src/f${String(i + 1).padStart(2, "0")}.ts`,
      percent: 50,
      coveredLines: 1,
      coverableLines: 2,
      uncoveredLines: [2],
    }));
    const skills30 = Array.from({ length: 30 }, (_, i) => ({
      path: `.claude/skills/s${String(i + 1).padStart(2, "0")}/SKILL.md`,
      kind: "claude-skill",
    }));

    const reports = {
      // AC-1: the golden inputs.
      golden: check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: 80,
        repoFiles: fixture("golden/files.txt").trim().split("\n"),
      }),
      // AC-2: the edge states.
      notComputed: buildReport({
        version: "0.1.0",
        threshold: 80,
        diffCoverage: null,
        missing: { reason: "coverage-file-missing", coverageFile: "coverage/lcov.info" },
        agentSetup: { files: agents },
      }),
      noCoverable: buildReport({
        version: "0.1.0",
        threshold: 80,
        diffCoverage: { percent: null, threshold: 80, ...empty },
        agentSetup: { files: agents },
      }),
      noThreshold: buildReport({
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
      }),
      noSetup: buildReport({
        version: "0.1.0",
        threshold: null,
        diffCoverage: { percent: null, threshold: null, ...empty },
        agentSetup: { files: [] },
      }),
      oneSetup: buildReport({
        version: "0.1.0",
        threshold: null,
        diffCoverage: { percent: null, threshold: null, ...empty },
        agentSetup: { files: agents },
      }),
      // AC-3: 30 files of each kind.
      thirty: buildReport({
        version: "0.1.0",
        threshold: 80,
        diffCoverage: {
          percent: 50,
          threshold: 80,
          coveredLines: 30,
          coverableLines: 60,
          files: files30,
          meetsThreshold: false,
        },
        agentSetup: { files: skills30 as never },
      }),
    };

    for (const [name, report] of Object.entries(reports)) {
      expectValidReport(report);
      const md = renderMarkdown(report);
      const lines = md.split("\n");
      const nonEmpty = lines.filter((l) => l.trim() !== "");

      // Line 0 is the fixed logo, line 1 is empty; above Diff coverage: the verdict heading, the overview sentence,
      // then the summary table (no other image line).
      expect(lines[0], name).toBe(LOGO);
      expect(lines[1], name).toBe("");
      const heading = lines.findIndex((l) => l.startsWith("## "));
      expect(heading, name).toBe(2);
      const diffSection = lines.indexOf("### 🧪 Diff coverage");
      expect(lines[heading], name).toMatch(/^## 🛡️ pharn-ci · \S+ (Pass|Warn|Fail)$/);
      expect(diffSection, name).toBeGreaterThan(heading);
      const between = lines.slice(heading + 1, diffSection).filter((l) => l.trim() !== "");
      expect(between.length, `${name}: callout and summary table above Diff coverage`).toBeGreaterThan(2);
      // pr-comment-verdict-callout put the overview sentence in a callout: the alert marker, then its content line.
      const [marker, overview, ...tableRows] = between;
      expect(marker, `${name}: alert marker`).toMatch(/^> \[!(TIP|WARNING|CAUTION)\]$/);
      expect(overview, `${name}: overview sentence`).toMatch(
        /^> \*\*(Pass|Warn|Fail)\*\* · (Diff coverage |This change ).*found\.$/,
      );
      expect(tableRows.length, `${name}: summary table above Diff coverage`).toBeGreaterThan(0);
      for (const line of tableRows) expect(line, `${name}: summary table line`).toMatch(/^\|.*\|$/);

      // The last non-empty line: <sub> with pharn-ci, then the tool version, then the schema version.
      const last = nonEmpty.at(-1) ?? "";
      expect(last, name).toMatch(/^<sub>.*<\/sub>$/);
      const tool = last.indexOf("pharn-ci");
      const version = last.indexOf(report.tool.version, tool + "pharn-ci".length);
      const schema = last.indexOf("report schema v1", version + report.tool.version.length);
      expect(tool, `${name}: footer names pharn-ci`).toBeGreaterThanOrEqual(0);
      expect(version, `${name}: footer names the tool version after pharn-ci`).toBeGreaterThan(tool);
      expect(schema, `${name}: footer names report schema v1 after the version`).toBeGreaterThan(version);

      // No image, no remote URL, apart from the logo line (line 0).
      const rest = lines.slice(1).join("\n");
      expect(rest, name).not.toContain("<img");
      expect(rest, name).not.toContain("![");
      expect(rest, name).not.toContain("http://");
      expect(rest, name).not.toContain("https://");
    }
  });
});
