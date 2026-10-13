import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the renderer and the fixtures are loaded inside each test body: the AC tests are written before the
// coverage path check and fixtures/coverage-paths/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const BENIGN_PATH = "src/benign.ts";

/** C0 (CR and LF included), DEL, C1 (U+0085 included), and the Unicode line and paragraph separators. */
function isLineBreakOrControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

const hasLineBreakOrControl = (text: string) => [...text].some(isLineBreakOrControl);

/** The characters of a path before its first and after its last backtick or control character. */
function plainEnds(path: string): { head: string; tail: string } {
  const chars = [...path];
  const special = (char: string) => char === "`" || isLineBreakOrControl(char);
  const first = chars.findIndex(special);
  const last = chars.length - 1 - [...chars].reverse().findIndex(special);
  return { head: chars.slice(0, first).join(""), tail: chars.slice(last + 1).join("") };
}

/** The raw path of the coverage text's one SF: record, as written up to the line feed. */
function rawPath(coverageText: string): string {
  const start = coverageText.indexOf("SF:") + "SF:".length;
  return coverageText.slice(start, coverageText.indexOf("\n", start));
}

async function render(coverageText: string) {
  const { check } = await import("../src/check.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: coverageText, format: "lcov" },
    diff: { text: fixture("coverage-paths/absolute-elsewhere/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("coverage-paths/hostile/files.txt").trim().split("\n"),
  });
  return { report, markdown: renderMarkdown(report) };
}

describe("check() and renderMarkdown(): a hostile coverage path", () => {
  it("AC-6: the unmatched path stays inside one code span on one line, and the markdown gets no line, heading or tag from it", async () => {
    const text = fixture("coverage-paths/hostile/coverage.info");
    // The fixture carries the hostile characters inside its one SF: path.
    const path = rawPath(text);
    for (const needed of ["`", "|", "<script>", " ", "\u0085"]) {
      expect(path, `the fixture path holds ${JSON.stringify(needed)}`).toContain(needed);
    }

    // The fixture as written, and a variant whose U+2028 is a lone carriage return.
    for (const [label, coverageText] of [
      ["fixture", text],
      ["carriage return", text.replace(" ", "\r")],
    ] as const) {
      const { report, markdown } = await render(coverageText);
      expectValidReport(report);
      const unmatched = report.messages.filter((message) => message.code === "COVERAGE_PATHS_UNMATCHED");
      expect(unmatched, label).toHaveLength(1);
      const messageText = unmatched[0]?.text ?? "";
      expect(hasLineBreakOrControl(messageText), `${label}: the message text is one line`).toBe(false);

      // Backticks pair up, and the path, past its own backticks, sits inside one code span.
      expect((messageText.match(/`/g) ?? []).length % 2, `${label}: backticks pair up`).toBe(0);
      const spans = [...messageText.matchAll(/`([^`]*)`/g)].map((match) => match[1] ?? "");
      const { head, tail } = plainEnds(path);
      expect(
        spans.some((span) => span.startsWith(head) && span.includes("alert(1)")),
        `${label}: one code span holds the path past its backticks: ${JSON.stringify(spans)}`,
      ).toBe(true);
      if (label === "fixture") {
        expect(
          spans.some((span) => span.startsWith(head) && span.includes("alert(1)") && span.endsWith(tail)),
          `fixture: one code span holds the whole path: ${JSON.stringify(spans)}`,
        ).toBe(true);
      }

      expect(markdown, label).not.toContain("<script>");
      expect(markdown, label).not.toContain("</script>");
      expect(hasLineBreakOrControl(markdown.replaceAll("\n", "")), `${label}: no control character but LF`).toBe(false);

      // Against the same report for a benign unmatched path, the markdown has the same lines and headings, and
      // differs in one line only: the message bullet. So the path adds no line, heading or list item of its own.
      const benign = await render(coverageText.replace(rawPath(coverageText), BENIGN_PATH));
      const lines = markdown.split("\n");
      const benignLines = benign.markdown.split("\n");
      expect(lines.length, `${label}: rendered line count`).toBe(benignLines.length);
      const headings = (all: string[]) => all.filter((line) => line.trimStart().startsWith("#"));
      expect(headings(lines), `${label}: headings`).toEqual(headings(benignLines));
      const changed = lines.filter((line, index) => line !== benignLines[index]);
      expect(changed, `${label}: changed lines`).toHaveLength(1);
      expect(changed[0], label).toMatch(/^- .*`COVERAGE_PATHS_UNMATCHED`/);
      expect(changed[0], label).toContain("alert(1)");
      expect(
        lines.filter((line) => line.includes("alert(1)")),
        label,
      ).toHaveLength(1);
    }
  });
});
