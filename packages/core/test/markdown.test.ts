import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { formatRanges, renderMarkdown } from "../src/render/markdown.js";
import { buildReport } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

describe("formatRanges", () => {
  it("collapses consecutive lines", () => {
    expect(formatRanges([])).toBe("");
    expect(formatRanges([5])).toBe("5");
    expect(formatRanges([1, 2, 3, 7, 9, 10])).toBe("1-3, 7, 9-10");
  });
});

describe("renderMarkdown", () => {
  it("renders the not-computed state", () => {
    const report = buildReport({
      version: "0.1.0",
      threshold: 80,
      diffCoverage: null,
      missing: { reason: "coverage-file-missing", coverageFile: "coverage/lcov.info" },
      agentSetup: { files: [] },
    });
    expect(renderMarkdown(report)).toMatchSnapshot();
  });

  it("renders the no-coverable-changes state", () => {
    const report = buildReport({
      version: "0.1.0",
      threshold: null,
      diffCoverage: {
        percent: null,
        threshold: null,
        coveredLines: 0,
        coverableLines: 0,
        files: [],
        meetsThreshold: true,
      },
      agentSetup: { files: [{ path: "AGENTS.md", kind: "agents-md" }] },
    });
    expect(renderMarkdown(report)).toMatchSnapshot();
  });

  it("truncates long tables and escapes paths", () => {
    const files = Array.from({ length: 4 }, (_, i) => ({
      path: `src/a|b\`${i}.ts`,
      percent: 100,
      coveredLines: 1,
      coverableLines: 1,
      uncoveredLines: [],
    }));
    const report = buildReport({
      version: "0.1.0",
      threshold: null,
      diffCoverage: { percent: 100, threshold: null, coveredLines: 4, coverableLines: 4, files, meetsThreshold: true },
      agentSetup: { files: [] },
    });
    const md = renderMarkdown(report, { maxRows: 2 });
    expect(md).toContain("| `src/a\\|b'0.ts` | 100% | 1/1 |  |");
    expect(md).toContain("_…and 2 more files_");
    expect(md).not.toContain("b'2.ts");
  });

  it("keeps PR-controlled paths and message text from injecting markdown", () => {
    const hostile = JSON.parse(fixture("render/hostile-paths.json")) as Hostile;
    const render = (repoFiles: string[], coverageFile: string) => {
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
    const md = render(hostile.repoFiles, hostile.coverageFile);
    // The same report with harmless names: the hostile one must not gain a single line.
    const benign = render(
      hostile.repoFiles.map((p, i) => (i === 0 ? p : `.claude/skills/benign${i}/CLAUDE.md`)),
      "coverage/lcov.info",
    );
    const lines = md.split("\n");

    expect(lines).toHaveLength(benign.split("\n").length);
    expect(lines.filter((l) => l.startsWith("## "))).toEqual(["## ❌ pharn-ci: fail"]);
    expect(lines.filter((l) => l.startsWith("@") || l.startsWith("<img"))).toEqual([]);
    // Outside code spans (where GitHub renders it literally), raw HTML must not survive.
    expect(md.replace(/`[^`\n]*`/g, "")).not.toContain("<img");
    expect(md).toContain("&lt;img src=x&gt;");
    // No path opens an extra table cell, even for a parser that pairs up backslashes: drop escaped
    // backslashes, then escaped pipes, and every agent-setup row has exactly its three separators.
    const separators = (row: string) => row.replace(/\\\\/g, "").replace(/\\\|/g, "").split("|").length - 1;
    const rows = lines.filter((l) => / \| claude-md \|$| \| agents-md \|$| \| claude-\w+ \|$/.test(l));
    expect(rows).toHaveLength(hostile.repoFiles.length);
    for (const row of rows) expect(separators(row), row).toBe(3);
    // The coverage path from the PR's .pharn/ci.yml becomes message text: it must stay inert too.
    const message = lines.find((l) => l.includes("`COVERAGE_FILE_MISSING`")) ?? "";
    expectInert(message);
  });

  it("keeps PR-controlled message text from rendering links, emphasis, mentions or autolinks", () => {
    const hostile = JSON.parse(fixture("render/hostile-paths.json")) as Hostile;
    const report = check({
      version: "0.1.0",
      coverage: { text: "", format: "auto" },
      // The Action's wording when git cannot diff against the base ref the PR names.
      diff: {
        unavailable: `could not get the diff for ${hostile.baseRef}...HEAD (use actions/checkout with fetch-depth: 0)`,
      },
      threshold: 80,
      repoFiles: ["AGENTS.md"],
    });
    expectValidReport(report);
    // The report keeps the text as given: message text is stable API, only the rendering escapes it.
    expect(report.messages[0]?.text).toContain(hostile.baseRef);
    const md = renderMarkdown(report);
    const message = md.split("\n").find((l) => l.includes("`DIFF_UNAVAILABLE`")) ?? "";

    expect(message).toBe(
      "- ❌ `DIFF_UNAVAILABLE` Diff coverage was not computed: could not get the diff for main " +
        "\\[verify your account\\](https:\\/\\/evil.example) @\u200Boctocat \\*\\*urgent\\*\\* \\~\\~x\\~\\~ " +
        "\\!\\[i\\](www\\.evil.example/i.png) \\_em\\_ \\`t\\` \\#1 \\\\...HEAD (use actions/checkout with fetch-depth: 0)",
    );
    expectInert(message);
  });
});

interface Hostile {
  repoFiles: string[];
  coverageFile: string;
  baseRef: string;
}

/**
 * A message line, read as GitHub would: once backslash escapes and code spans are dropped, nothing
 * that opens a link, image, emphasis, strikethrough, heading, mention, autolink or raw HTML is left.
 */
function expectInert(line: string): void {
  expect(line).toMatch(/^- \S+ `[A-Z_]+` /);
  const live = line.replace(/\\[\s\S]/g, "").replace(/`[^`]*`/g, "");
  expect(live).not.toContain("](");
  expect(live).not.toMatch(/[[\]*_~!#`<>\\]/);
  expect(live).not.toMatch(/@\w/);
  expect(live).not.toContain("://");
  expect(live).not.toMatch(/www\./i);
}
