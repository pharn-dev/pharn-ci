import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-bold-look AC-6. check() and the renderer are loaded inside the test body: the AC tests are written before
// the build, so nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const SHIELD = "\u{1F6E1}️";
const DOT = "·";
const HEADING_PREFIX = `## ${SHIELD} pharn-ci ${DOT} `;

interface Hostile {
  repoFiles: string[];
  coverageFile: string;
  baseRef: string;
}

const hostile: Hostile = JSON.parse(fixture("render/hostile-paths.json"));
const benign: Hostile = {
  repoFiles: fixture("golden/files.txt").trim().split("\n"),
  coverageFile: "coverage/lcov.info",
  baseRef: "main",
};

/** The two reports the criterion names: a missing coverage file, and an unavailable diff. */
async function reports(input: Hostile): Promise<Report[]> {
  const { check } = await import("../src/check.js");
  const missingCoverage = check({
    version: "0.1.0",
    coverage: { missingFile: input.coverageFile },
    diff: { text: fixture("golden/pr.diff") },
    threshold: 80,
    repoFiles: input.repoFiles,
  });
  const diffUnavailable = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { unavailable: input.baseRef },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: input.repoFiles,
  });
  for (const report of [missingCoverage, diffUnavailable]) expectValidReport(report);
  return [missingCoverage, diffUnavailable];
}

/**
 * The line read as markdown outside code spans: a backslash-escaped character becomes U+FFFC (inert), and a code span
 * (backtick to backtick, where backslashes are literal) is dropped.
 */
function outsideCode(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const char = line[i] ?? "";
    if (char === "\\" && i + 1 < line.length) {
      out += "￼";
      i += 2;
    } else if (char === "`") {
      const close = line.indexOf("`", i + 1);
      if (close === -1) {
        out += char;
        i++;
      } else {
        i = close + 1;
      }
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

/** Pipes that separate cells: every `|` not escaped by a backslash. */
const cellSeparators = (row: string) => [...row.matchAll(/(?<!\\)\|/g)].length;

/** Runs of consecutive lines that start with `|`. */
function tables(lines: readonly string[]): string[][] {
  const found: string[][] = [];
  let current: string[] = [];
  for (const line of [...lines, ""]) {
    if (line.startsWith("|")) {
      current.push(line);
    } else if (current.length > 0) {
      found.push(current);
      current = [];
    }
  }
  return found;
}

/** The non-empty lines of the Messages section: from its heading to the next heading. */
function messageLines(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line.startsWith("### 💬 Messages ("));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("#"));
  return lines.slice(start + 1, end === -1 ? lines.length : end).filter((line) => line.trim() !== "");
}

/** Every run of 6 code points of the input strings that the benign rendering does not also contain. */
function hostileRuns(inputs: readonly string[], benignMarkdown: string): string[] {
  const runs = new Set<string>();
  for (const input of inputs) {
    const chars = [...input];
    for (let i = 0; i + 6 <= chars.length; i++) {
      const run = chars.slice(i, i + 6).join("");
      if (!benignMarkdown.includes(run)) runs.add(run);
    }
  }
  return [...runs];
}

describe("renderMarkdown(): the new header, summaries and footer with hostile paths and message text", () => {
  it("AC-6: no image, no broken table row, no input text in the fixed lines, and inert message lines", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const benignMarkdown = (await reports(benign)).map((report) => renderMarkdown(report)).join("\n");
    const inputs = [...hostile.repoFiles, hostile.coverageFile, hostile.baseRef];
    const runs = hostileRuns(inputs, benignMarkdown);
    expect(runs.length, "the fixture carries text the benign rendering lacks").toBeGreaterThan(0);

    for (const report of await reports(hostile)) {
      const markdown = renderMarkdown(report);
      const lines = markdown.split("\n");
      const label = report.messages.map((m) => m.code).join(",");

      // No image outside a code span.
      for (const line of lines) {
        expect(outsideCode(line), `${label}: no <img outside code: ${line}`).not.toContain("<img");
      }

      // Every table row has as many cells as its header row.
      const found = tables(lines);
      expect(found.length, `${label}: tables present`).toBeGreaterThan(0);
      for (const table of found) {
        const width = cellSeparators(table[0] ?? "");
        for (const row of table) expect(cellSeparators(row), `${label}: cell count of ${row}`).toBe(width);
      }

      // The fixed lines: the heading, the overview sentence, every <summary> line and the footer.
      const heading = lines.findIndex((line) => line.startsWith(HEADING_PREFIX));
      expect(heading, `${label}: the branded heading`).toBeGreaterThan(-1);
      const overview = lines.findIndex((line, index) => index > heading && line.trim() !== "");
      expect(lines[overview]?.endsWith("found."), `${label}: the overview sentence: ${lines[overview]}`).toBe(true);
      const nonEmpty = lines.filter((line) => line.trim() !== "");
      const footer = nonEmpty[nonEmpty.length - 1] ?? "";
      expect(footer.startsWith("<sub>pharn-ci "), `${label}: the footer: ${footer}`).toBe(true);
      expect(nonEmpty[nonEmpty.length - 2], `${label}: the thematic break before the footer`).toBe("---");
      const summaries = lines.filter((line) => line.includes("<summary>"));
      expect(summaries.length, `${label}: the agent setup files block has a summary`).toBeGreaterThan(0);

      const fixedLines = [lines[heading] ?? "", lines[overview] ?? "", footer, ...summaries];
      for (const line of fixedLines) {
        for (const input of inputs) expect(line.includes(input), `${label}: input text in ${line}`).toBe(false);
        const leaked = runs.filter((run) => line.includes(run));
        expect(leaked, `${label}: input text in ${line}`).toEqual([]);
      }

      // Message lines are inert: no live link, unescaped markdown character, mention, scheme or www.
      const shown = messageLines(lines);
      expect(shown.length, `${label}: message lines present`).toBeGreaterThanOrEqual(report.messages.length);
      for (const line of shown) {
        const body = outsideCode(line.replace(/^(- | {2}- )/, ""));
        expect(body, `${label}: live link in ${line}`).not.toContain("](");
        expect(body, `${label}: unescaped markdown character in ${line}`).not.toMatch(/[*_~[\]<>!#`|]/);
        expect(line, `${label}: live mention in ${line}`).not.toMatch(/@\w/);
        expect(line, `${label}: scheme in ${line}`).not.toContain("://");
        expect(line, `${label}: www. in ${line}`).not.toContain("www.");
      }
    }
  });
});
