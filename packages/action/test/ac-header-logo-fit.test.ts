import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fixture, harness, SCOPE } from "./harness.js";

// pr-comment-logo-2 AC-6. run(), fitMarkdown() and the renderer are loaded inside the test body: the AC tests are
// written before the build, so nothing the build changes may run while the file loads.

/** The one fixed logo line, written here so the test does not reuse the renderer's own constant. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const HEADING_PREFIX = "## \u{1F6E1}\u{FE0F} pharn-ci · ";

/** 50 agent setup files, each with a path of `width` characters plus a short suffix. */
function longSkillPaths(width: number): string[] {
  return Array.from({ length: 50 }, (_, i) => `.claude/skills/${"x".repeat(width)}${i}/SKILL.md`);
}

/** The overview sentence, the summary table's value row and every message line of a full rendering. */
function keptLines(markdown: string): { overview: string; valueRow: string; messages: string[] } {
  const lines = markdown.split("\n");
  const heading = lines.findIndex((line) => line.startsWith(HEADING_PREFIX));
  const overview = lines.slice(heading + 1).find((line) => line.trim() !== "") ?? "";
  const separator = lines.findIndex((line) => /^\|( --- \|)+$/.test(line));
  const valueRow = lines[separator + 1] ?? "";
  const start = lines.findIndex((line) => line.startsWith("### 💬 Messages ("));
  const end = lines.findIndex((line, index) => index > start && line.startsWith("#"));
  const messages =
    start === -1
      ? []
      : lines.slice(start + 1, end === -1 ? lines.length : end).filter((line) => line.trimStart().startsWith("- "));
  return { overview, valueRow, messages };
}

describe("action: the fitted sticky comment keeps the logo and heading", () => {
  it("AC-6: an oversized comment fits the limit and still opens with marker, scope line, logo line, empty line and heading", async () => {
    const { COMMENT_MARKER, MAX_COMMENT_LENGTH, commentScopeLine, fitMarkdown, run } = await import("../src/run.js");
    const { renderMarkdown } = await import("@pharn-ci/core");
    expect(MAX_COMMENT_LENGTH).toBe(65_000);

    // Through run(): 50 agent setup files with 2,000-character paths and a coverage gate.
    const h = harness({
      inputs: { threshold: "80" },
      lsFiles: [...fixture("golden/files.txt").trim().split("\n"), ...longSkillPaths(2_000)],
    });
    const report = await run(h.deps);
    if (report === undefined) throw new Error("run() returned no report");
    expectValidReport(report);
    expect(report.messages.length).toBeGreaterThan(0);

    const full = renderMarkdown(report);
    expect(full.length).toBeGreaterThan(MAX_COMMENT_LENGTH);
    const kept = keptLines(full);
    expect(kept.overview).not.toBe("");
    expect(kept.valueRow.startsWith("| ")).toBe(true);
    // One top-level line per message; its hint lines are kept too.
    expect(kept.messages.filter((line) => line.startsWith("- ")).length).toBe(report.messages.length);

    expect(h.posted).toHaveLength(1);
    const posted = h.posted[0] as string;

    // Directly: fitMarkdown with the marker and a scope line as prefix.
    const prefix = `${COMMENT_MARKER}\n${commentScopeLine("CI", "pharn")}\n`;
    const direct = fitMarkdown(report, {
      prefix,
      note: "\n\n_Truncated._\n",
      fits: (text) => text.length <= MAX_COMMENT_LENGTH,
    });

    const cases: [string, string, string][] = [
      ["run()", posted, `${COMMENT_MARKER}\n${SCOPE}\n`],
      ["fitMarkdown()", direct, prefix],
    ];
    for (const [name, body, head] of cases) {
      expect(body.length, name).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
      expect(body.startsWith(`${head}${LOGO}\n\n${HEADING_PREFIX}`), `${name}: ${body.slice(0, 300)}`).toBe(true);
      expect(body, `${name}: overview`).toContain(kept.overview);
      expect(body, `${name}: value row`).toContain(kept.valueRow);
      for (const line of kept.messages) {
        expect(body, `${name}: ${line}`).toContain(line);
      }
    }
  });
});
