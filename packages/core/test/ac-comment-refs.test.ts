import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { buildReport } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-124 (R5.7) part A. GitHub turns issue references into links after it renders markdown, where a backslash no
// longer counts: `org/repo#1`, `#1`, `GH-1` (any case) and `org/repo/issues/1` (also `pull`, `discussions`) each
// linked in message text (checked with GitHub's markdown API, PR body), and a link to another repository's issue adds
// a "mentioned this" entry there. The renderer now puts a zero-width space before the number, as it puts one after
// every `@`.

const ZWSP = "​";
const PREFIX = "- ❌ `DIFF_UNAVAILABLE` Diff coverage was not computed: ";

/** The DIFF_UNAVAILABLE line for a diff that could not be read, whose reason carries `text` (as a base ref would). */
function messageLine(text: string): string {
  const report = check({
    version: "0.1.0",
    coverage: { text: "", format: "auto" },
    diff: { unavailable: text },
    threshold: 80,
    repoFiles: ["AGENTS.md"],
  });
  expectValidReport(report);
  // The report keeps the text as given: only the rendering breaks the references.
  expect(report.messages.find((m) => m.code === "DIFF_UNAVAILABLE")?.text).toContain(text);
  return (
    renderMarkdown(report)
      .split("\n")
      .find((l) => l.includes("`DIFF_UNAVAILABLE`")) ?? ""
  );
}

/** The line as GitHub reads it for references: backslash escapes dropped, code spans removed. */
function live(line: string): string {
  return line.replace(/\\([\s\S])/g, "$1").replace(/`[^`]*`/g, "");
}

const lines = fixture("comment-refs/references.txt")
  .split("\n")
  .filter((l) => l !== "");

describe("message text cannot link an issue (CORE-124)", () => {
  it("breaks every issue reference with a zero-width space before the number", () => {
    const rendered = lines.map((l) => messageLine(l).slice(PREFIX.length));
    expect(rendered).toEqual([
      `issue in another repository: org/repo\\#${ZWSP}1 and pharn-dev/pharn-ci\\#${ZWSP}12`,
      `issue in this repository: \\#${ZWSP}1, (\\#${ZWSP}2) and \\#${ZWSP}345`,
      `GitHub's own prefix: GH-${ZWSP}1, gh-${ZWSP}2 and Gh-${ZWSP}3`,
      `issue paths: org/repo/issues/${ZWSP}1, github.com/org/repo/pull/${ZWSP}2, ` +
        `https:\\/\\/github.com/org/repo/discussions/${ZWSP}3 and org/repo/ISSUES/${ZWSP}4`,
      // A commit in another repository was already broken by the zero-width space after "@".
      `commit in another repository: org/repo@${ZWSP}a63a7f55c74b39a44634cf72501d8ea73f87bb23`,
      // Not references: left as they were.
      "not references: \\#abc, GH-abc, C\\# and issues/ alone",
    ]);
  });

  it("leaves no reference GitHub would link in the rendered line", () => {
    for (const line of lines) {
      const text = live(messageLine(line));
      expect(text, line).not.toMatch(/#\d/);
      expect(text, line).not.toMatch(/gh-\d/i);
      expect(text, line).not.toMatch(/\/(?:issues|pulls?|discussions)\/\d/i);
      expect(text, line).not.toMatch(/@[\w-]/);
    }
  });

  it("keeps a path inside a code span as it is", () => {
    const path = "src/org/repo#1/GH-2/issues/3.ts";
    const report = buildReport({
      version: "0.1.0",
      threshold: null,
      diffCoverage: {
        percent: 100,
        threshold: null,
        coveredLines: 1,
        coverableLines: 1,
        files: [{ path, percent: 100, coveredLines: 1, coverableLines: 1, uncoveredLines: [] }],
        meetsThreshold: true,
      },
      agentSetup: { files: [] },
    });
    expectValidReport(report);
    const md = renderMarkdown(report);
    expect(md).toContain(`| \`${path}\` | 100% | 1/1 |  |`);
    expect(md).not.toContain(ZWSP);
  });
});
