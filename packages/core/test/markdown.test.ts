import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { logoMarkup } from "../src/render/logo.js";
import { formatRanges, renderMarkdown } from "../src/render/markdown.js";
import { buildReport } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport, validateReport } from "./schema.js";

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
    expect(lines.filter((l) => l.startsWith("## "))).toEqual(["## 🛡️ pharn-ci · ❌ Fail"]);
    // Line 0 is the fixed logo line, the only image; every other line is checked.
    expect(lines[0]).toBe(logoMarkup());
    expect(lines.slice(1).filter((l) => l.startsWith("@") || l.startsWith("<img"))).toEqual([]);
    // Outside code spans (where GitHub renders it literally), raw HTML must not survive.
    expect(
      lines
        .slice(1)
        .join("\n")
        .replace(/`[^`\n]*`/g, ""),
    ).not.toContain("<img");
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

describe("renderMarkdown explainability (F-32)", () => {
  type FileRow = {
    path: string;
    percent: number | null;
    coveredLines: number;
    coverableLines: number;
    uncoveredLines: number[];
  };
  const row = (path: string, percent: number | null, covered: number, coverable: number): FileRow => ({
    path,
    percent,
    coveredLines: covered,
    coverableLines: coverable,
    uncoveredLines: Array.from({ length: coverable - covered }, (_, i) => i + 1),
  });
  const reportWith = (files: FileRow[]) =>
    buildReport({
      version: "0.1.0",
      threshold: 80,
      diffCoverage: { percent: 50, threshold: 80, coveredLines: 1, coverableLines: 2, files, meetsThreshold: false },
      agentSetup: { files: [{ path: "AGENTS.md", kind: "agents-md" }] },
    });
  const tablePaths = (md: string) =>
    md
      .split("\n")
      .filter((l) => /^\| `/.test(l) && !l.includes("agents-md"))
      .map((l) => /`([^`]*)`/.exec(l)?.[1]);

  it("sorts file rows by coverage ascending, then path, with unmeasured files last", () => {
    const files = [
      row("a.ts", 100, 2, 2),
      row("z.ts", 0, 0, 1),
      row("n.ts", null, 0, 0),
      row("m.ts", 50, 1, 2),
      row("b.ts", 50, 1, 2),
    ];
    const report = reportWith(files);
    expectValidReport(report);
    expect(tablePaths(renderMarkdown(report))).toEqual(["z.ts", "b.ts", "m.ts", "a.ts", "n.ts"]);
    // The report itself keeps its path order: sorting is a rendering choice.
    expect(report.diffCoverage?.files.map((f) => f.path)).toEqual(["a.ts", "z.ts", "n.ts", "m.ts", "b.ts"]);
  });

  it("keeps the worst files when truncating and points to report.json", () => {
    // 60 files in path order; the 3 failing ones sort last by path and used to be cut at 50 rows.
    const files = [
      ...Array.from({ length: 57 }, (_, i) => row(`src/ok${String(i).padStart(2, "0")}.ts`, 100, 1, 1)),
      row("src/zz-a.ts", 0, 0, 3),
      row("src/zz-b.ts", 25, 1, 4),
      row("src/zz-c.ts", 50, 1, 2),
    ];
    const md = renderMarkdown(reportWith(files));
    const paths = tablePaths(md);
    expect(paths).toHaveLength(50);
    expect(paths.slice(0, 3)).toEqual(["src/zz-a.ts", "src/zz-b.ts", "src/zz-c.ts"]);
    expect(md).toContain("| _…and 10 more files_ | | | |");
    expect(md).toContain(
      "_Full list in report.json: the Action's `report-path` output, or `pharn-ci check --format json`._",
    );
    // No pointer when nothing was cut.
    expect(renderMarkdown(reportWith(files.slice(0, 50)))).not.toContain("report.json");
  });

  it("adds a one-line hint under every message code", () => {
    const codes = [
      "DIFF_COVERAGE_BELOW_THRESHOLD",
      "DIFF_COVERAGE_UNGATED",
      "NO_COVERABLE_CHANGES",
      "COVERAGE_FILE_MISSING",
      "COVERAGE_FILE_EMPTY",
      "COVERAGE_FORMAT_UNSUPPORTED",
      "DIFF_UNAVAILABLE",
      "NO_AGENT_SETUP_FILES",
    ] as const;
    // Every code the schema documents has a hint.
    const schemaCodes = /Known codes: ([A-Z_, ]+)\./.exec(JSON.stringify(validateReport.schema))?.[1]?.split(", ");
    expect(schemaCodes).toEqual([...codes]);

    const report = buildReport({
      version: "0.1.0",
      threshold: null,
      diffCoverage: null,
      agentSetup: { files: [] },
    });
    report.messages = codes.map((code) => ({ level: "info", code, text: `text of ${code}` }));
    expectValidReport(report);
    const lines = renderMarkdown(report).split("\n");
    for (const code of codes) {
      const at = lines.findIndex((l) => l.includes(`\`${code}\``));
      expect(lines[at + 1], code).toMatch(/^ {2}- Hint: \S.{10,}$/);
    }

    // A code from a newer producer renders without a hint instead of failing.
    report.messages = [{ level: "warn", code: "SOME_NEW_CODE" as never, text: "new" }];
    const md = renderMarkdown(report);
    expect(md).toContain("- ⚠️ `SOME_NEW_CODE` new\n\n");
    expect(md).not.toContain("Hint:");
  });

  it("says what agent setup is missing when none is found, and only then", () => {
    const missing = "Missing: an agent instructions file, typically `AGENTS.md` or `CLAUDE.md` at the repository root.";
    const none = buildReport({ version: "0.1.0", threshold: null, diffCoverage: null, agentSetup: { files: [] } });
    const lines = renderMarkdown(none).split("\n");
    const section = lines.indexOf("### 🤖 Agent setup (no files)");
    expect(lines.slice(section, section + 5)).toEqual([
      "### 🤖 Agent setup (no files)",
      "",
      "_No agent setup files found._",
      "",
      missing,
    ]);

    const some = reportWith([row("a.ts", 100, 1, 1)]);
    expect(renderMarkdown(some)).not.toContain("Missing:");
  });
});
