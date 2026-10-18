import { describe, expect, it } from "vitest";
import { fixture, harness } from "./harness.js";

// pr-comment-bold-look AC-8. run(), fitMarkdown() and the renderer are loaded inside the test body: the AC tests are
// written before the build, so nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const SHIELD = "\u{1F6E1}️";
const DOT = "·";
const HEADING_PREFIX = `## ${SHIELD} pharn-ci ${DOT} `;
/** The fixed logo line (pr-comment-logo-2) that opens the rendering, then an empty line, then the heading. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

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

describe("run(): the new header block in a sticky comment that has to be shortened", () => {
  it("AC-8: a report too long for one comment keeps the heading, the overview sentence, the summary row and every message", async () => {
    const { run, fitMarkdown, COMMENT_MARKER, MAX_COMMENT_LENGTH, commentScopeLine } = await import("../src/run.js");
    const { renderMarkdown } = await import("@pharn-ci/core");

    const h = harness({
      inputs: { threshold: "80" },
      lsFiles: [...fixture("golden/files.txt").trim().split("\n"), ...LONG_SETUP_FILES],
    });
    const report = await run(h.deps);
    expect(report).toBeDefined();
    if (report === undefined) return;
    expect(report.verdict).toBe("fail");
    const setupFiles = report.agentSetup.files.length;
    expect(setupFiles).toBe(58);

    const full = renderMarkdown(report);
    expect(full.length, "the full rendering is over the comment limit").toBeGreaterThan(MAX_COMMENT_LENGTH);
    expect(MAX_COMMENT_LENGTH).toBe(65_000);

    const scopeLine = commentScopeLine("", "");
    const prefix = `${COMMENT_MARKER}\n${scopeLine}\n`;
    const direct = fitMarkdown(report, {
      prefix,
      note: "\n\n_Truncated._\n",
      fits: (text) => text.length <= MAX_COMMENT_LENGTH,
    });
    expect(h.posted).toHaveLength(1);
    const posted = h.posted[0] ?? "";

    const fullLines = full.split("\n");
    const overview = `Diff coverage of this change is 71.43% against a threshold of 80%; ${setupFiles} agent setup files found.`;
    const valueRow = `| ❌ Fail | 71.43% (threshold 80%) | ${setupFiles} files |`;
    // The non-empty lines of the full rendering are the logo line, the heading, then the overview sentence.
    expect(fullLines.filter((line) => line.trim() !== "")[0], "the logo line of the full rendering").toBe(LOGO);
    expect(fullLines.filter((line) => line.trim() !== "")[2], "the overview sentence of the full rendering").toBe(
      overview,
    );
    expect(fullLines, "the summary value row of the full rendering").toContain(valueRow);
    const messages = messageLines(fullLines);
    expect(messages.length, "message lines of the full rendering").toBeGreaterThanOrEqual(report.messages.length);
    expect(report.messages.length).toBeGreaterThan(0);

    for (const [label, body] of [
      ["posted comment", posted],
      ["fitMarkdown", direct],
    ] as const) {
      expect(body.length, `${label}: within the limit`).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
      expect(
        body.startsWith(`${prefix}${LOGO}\n\n${HEADING_PREFIX}`),
        `${label}: marker, scope line, the logo block, then the heading`,
      ).toBe(true);
      const bodyLines = body.split("\n");
      expect(bodyLines, `${label}: the overview sentence`).toContain(overview);
      expect(bodyLines, `${label}: the summary value row`).toContain(valueRow);
      for (const line of messages) expect(bodyLines, `${label}: message line ${line}`).toContain(line);
    }
  });
});
