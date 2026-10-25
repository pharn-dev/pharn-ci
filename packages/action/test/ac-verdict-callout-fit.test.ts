import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fixture, harness, SCOPE } from "./harness.js";

// pr-comment-verdict-callout AC-6. run(), fitMarkdown() and the renderer are loaded inside the test body: the AC tests
// are written before the build, so nothing the build changes may run while the file loads.

/** The fixed logo line that opens the rendering, written here so the test does not reuse the renderer's constant. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';
/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const FAIL_HEADING = "## \u{1F6E1}\u{FE0F} pharn-ci · ❌ Fail";

/** 50 agent setup files with 2,000-character paths: their table rows push the render past the comment limit. */
const LONG_SETUP_FILES = Array.from(
  { length: 50 },
  (_, i) => `pkg-${String(i).padStart(2, "0")}-${"x".repeat(2000)}/CLAUDE.md`,
);

/** The non-empty lines of the Messages section: from its heading to the next heading. */
function messageLines(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line.startsWith("### 💬 Messages ("));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("#"));
  return lines.slice(start + 1, end === -1 ? lines.length : end).filter((line) => line.trim() !== "");
}

describe("run(): the verdict callout in a sticky comment that has to be shortened", () => {
  it("AC-6: a fitted comment opens with marker, scope, logo, heading and the CAUTION callout, and keeps the content line, value row and messages", async () => {
    const { run, fitMarkdown, COMMENT_MARKER, MAX_COMMENT_LENGTH, commentScopeLine } = await import("../src/run.js");
    const { renderMarkdown } = await import("@pharn-ci/core");

    const h = harness({
      inputs: { threshold: "80" },
      lsFiles: [...fixture("golden/files.txt").trim().split("\n"), ...LONG_SETUP_FILES],
    });
    const report = await run(h.deps);
    expect(report).toBeDefined();
    if (report === undefined) return;
    expectValidReport(report);
    expect(report.verdict).toBe("fail");
    const setupFiles = report.agentSetup.files.length;

    expect(MAX_COMMENT_LENGTH).toBe(65_000);
    const full = renderMarkdown(report);
    expect(full.length, "the full rendering is over the comment limit").toBeGreaterThan(MAX_COMMENT_LENGTH);

    const fullLines = full.split("\n");
    const content = `> **Fail** · Diff coverage of this change is 71.43% against a threshold of 80%; ${setupFiles} agent setup files found.`;
    expect(fullLines, "the callout content line of the full rendering").toContain(content);
    const valueRow = `| ❌ Fail | 71.43% (threshold 80%) | none (warn) | ${setupFiles} files |`;
    expect(fullLines, "the summary value row of the full rendering").toContain(valueRow);
    const messages = messageLines(fullLines);
    expect(report.messages.length).toBeGreaterThan(0);
    expect(messages.length, "message lines of the full rendering").toBeGreaterThanOrEqual(report.messages.length);

    const named = `${COMMENT_MARKER}\n${commentScopeLine("CI", "pharn")}\n`;
    const direct = fitMarkdown(report, {
      prefix: named,
      note: "\n\n_Truncated._\n",
      fits: (text) => text.length <= MAX_COMMENT_LENGTH,
    });
    expect(h.posted).toHaveLength(1);

    for (const [label, prefix, body] of [
      ["fitMarkdown", named, direct],
      ["posted comment", `${COMMENT_MARKER}\n${SCOPE}\n`, h.posted[0] ?? ""],
    ] as const) {
      expect(body.length, `${label}: within the limit`).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
      const opening = `${prefix}${LOGO}\n\n${FAIL_HEADING}\n\n> [!CAUTION]\n`;
      expect(body.slice(0, opening.length), `${label}: marker, scope, logo, heading, then the callout`).toBe(opening);
      const bodyLines = body.split("\n");
      expect(bodyLines, `${label}: the callout content line`).toContain(content);
      expect(bodyLines, `${label}: the summary value row`).toContain(valueRow);
      for (const line of messages) expect(bodyLines, `${label}: message line ${line}`).toContain(line);
    }
  });
});
