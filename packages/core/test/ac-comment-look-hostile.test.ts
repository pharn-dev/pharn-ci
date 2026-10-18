import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// AC test for pr-comment-redesign-2 (AC-5). Targets are imported inside the test body so the file loads before
// the build; one `it` for the AC. No snapshot: the expected values are written inline.

interface Hostile {
  repoFiles: string[];
  coverageFile: string;
  baseRef: string;
}

/** Non-empty lines between the verdict heading (first non-empty line) and `### 🧪 Diff coverage`. */
function summaryLines(md: string): string[] {
  const lines = md.split("\n");
  const heading = lines.findIndex((l) => l.trim() !== "");
  const diffSection = lines.indexOf("### 🧪 Diff coverage");
  expect(diffSection).toBeGreaterThan(heading);
  return lines.slice(heading + 1, diffSection).filter((l) => l.trim() !== "");
}

/** Cell separators of a table row, for a parser that pairs up backslashes: escaped pipes do not count. */
const separators = (row: string) => row.replace(/\\\\/g, "").replace(/\\\|/g, "").split("|").length - 1;

/** Every run of consecutive `|`-led lines is a table; every row has its header row's separator count. */
function expectTablesAligned(md: string): number {
  const lines = md.split("\n");
  let tables = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i] ?? "").startsWith("|")) continue;
    if (i > 0 && (lines[i - 1] ?? "").startsWith("|")) continue;
    tables++;
    const header = separators(lines[i] ?? "");
    for (let j = i; j < lines.length && (lines[j] ?? "").startsWith("|"); j++) {
      expect(separators(lines[j] ?? ""), lines[j]).toBe(header);
    }
  }
  return tables;
}

/** Message lines of the `### 💬 Messages (n)` section (the `- <icon> \`CODE\` text` lines). */
function messageLines(md: string): string[] {
  const lines = md.split("\n");
  const from = lines.findIndex((l) => l.startsWith("### 💬 Messages ("));
  const to = lines.findIndex((l) => l.startsWith("### 🤖 Agent setup ("));
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return lines.slice(from + 1, to).filter((l) => l.startsWith("- "));
}

/**
 * A message line, read as GitHub would: once backslash escapes and code spans are dropped, nothing that opens a
 * link, image, emphasis, strikethrough, heading, mention, autolink or raw HTML is left.
 */
function expectInert(line: string): void {
  expect(line).toMatch(/^- \S+ `[A-Z_]+` /);
  const live = line.replace(/\\[\s\S]/g, "").replace(/`[^`]*`/g, "");
  expect(live, line).not.toContain("](");
  expect(live, line).not.toMatch(/[[\]*_~!#`<>\\]/);
  expect(live, line).not.toMatch(/@\w/);
  expect(live, line).not.toContain("://");
  expect(live, line).not.toMatch(/www\./i);
}

describe("PR comment look: hostile paths and message text stay inert (pr-comment-redesign-2)", () => {
  it("AC-5: keeps the summary block fixed, tables aligned, no live <img and inert message lines", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const hostile = JSON.parse(fixture("render/hostile-paths.json")) as Hostile;

    const renderPaths = (repoFiles: string[], coverageFile: string) => {
      const report = check({
        version: "0.1.0",
        coverage: { missingFile: coverageFile },
        diff: { text: "" },
        threshold: 80,
        repoFiles,
      });
      expectValidReport(report);
      return renderMarkdown(report);
    };
    const md = renderPaths(hostile.repoFiles, hostile.coverageFile);
    // The same report with harmless names (the variant markdown.test.ts uses).
    const benign = renderPaths(
      hostile.repoFiles.map((p, i) => (i === 0 ? p : `.claude/skills/benign${i}/CLAUDE.md`)),
      "coverage/lcov.info",
    );

    const baseRefReport = check({
      version: "0.1.0",
      coverage: { text: "", format: "auto" },
      diff: {
        unavailable: `could not get the diff for ${hostile.baseRef}...HEAD (use actions/checkout with fetch-depth: 0)`,
      },
      threshold: 80,
      repoFiles: ["AGENTS.md"],
    });
    expectValidReport(baseRefReport);
    const mdBaseRef = renderMarkdown(baseRefReport);

    // The summary block above Diff coverage shows the fixed facts, and the hostile names change none of it.
    const summary = summaryLines(md);
    expect(summary.length, "summary block above Diff coverage").toBeGreaterThan(0);
    expect(summary.join("\n")).toContain("not computed");
    expect(summary.join("\n")).toContain("6 files");
    expect(summary).toEqual(summaryLines(benign));

    for (const [name, text] of [
      ["hostile paths", md],
      ["hostile base ref", mdBaseRef],
    ] as const) {
      // Outside code spans (where GitHub renders it literally), no raw <img survives, apart from the fixed logo
      // line, which is line 0.
      const { logoMarkup } = await import("../src/render/logo.js");
      const [logoLine = "", ...afterLogo] = text.split("\n");
      expect(logoLine, name).toBe(logoMarkup());
      expect(afterLogo.join("\n").replace(/`[^`\n]*`/g, ""), name).not.toContain("<img");
      // Every table, the summary table included, keeps its header's cell count.
      expect(expectTablesAligned(text), `${name}: tables`).toBeGreaterThan(0);
      // Every message line is inert.
      const messages = messageLines(text);
      expect(messages.length, `${name}: message lines`).toBeGreaterThan(0);
      for (const line of messages) expectInert(line);
    }
  });
});
