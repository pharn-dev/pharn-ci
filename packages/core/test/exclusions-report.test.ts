import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The schema validator, buildReport and renderMarkdown are loaded inside each test body, and every report is
// built there: these tests are written before excludedFiles exists, so nothing that depends on it may run
// while the file loads.

type BuildReport = typeof import("../src/report.js").buildReport;
type BuildReportInput = Parameters<BuildReport>[0];

/** A report with one measured file, the given excluded paths (if any) and one agent setup file. */
async function reportWith(excludedFiles: string[] | undefined, opts: { noCoverableLines?: boolean } = {}) {
  const { buildReport } = await import("../src/report.js");
  const measured = opts.noCoverableLines
    ? { percent: null, coveredLines: 0, coverableLines: 0, files: [] }
    : {
        percent: 50,
        coveredLines: 1,
        coverableLines: 2,
        files: [{ path: "src/app.ts", percent: 50, coveredLines: 1, coverableLines: 2, uncoveredLines: [2] }],
      };
  return buildReport({
    version: "0.1.0",
    threshold: null,
    diffCoverage: {
      threshold: null,
      meetsThreshold: true,
      ...measured,
      ...(excludedFiles === undefined ? {} : { excludedFiles }),
    },
    agentSetup: { files: [{ path: "AGENTS.md", kind: "agents-md" }] },
  } as BuildReportInput);
}

const BASE_REPORT = {
  schemaVersion: 2,
  tool: { name: "pharn-ci", version: "0.1.0" },
  verdict: "pass",
  diffCoverage: {
    percent: 100,
    threshold: null,
    coveredLines: 1,
    coverableLines: 1,
    files: [{ path: "b.ts", percent: 100, coveredLines: 1, coverableLines: 1, uncoveredLines: [] }],
  },
  agentSetup: { files: [] },
  messages: [],
  testIntegrity: { mode: "warn", source: "default", verdict: "pass", signals: [], languages: [] },
};

describe("report schema: diffCoverage.excludedFiles", () => {
  it("AC-14: accepts an optional array of non-empty path strings", async () => {
    const { validateReport } = await import("./schema.js");
    const withField = (excludedFiles: unknown) => ({
      ...BASE_REPORT,
      diffCoverage: { ...BASE_REPORT.diffCoverage, excludedFiles },
    });
    expect(validateReport(withField(["a.ts"])), JSON.stringify(validateReport.errors)).toBe(true);
    expect(validateReport(BASE_REPORT), JSON.stringify(validateReport.errors)).toBe(true);
    expect(validateReport(withField([""]))).toBe(false);
    expect(validateReport(withField([1]))).toBe(false);

    const schema = JSON.parse(fixture("../schema/report.v1.json")) as {
      $defs: { diffCoverage: { required: string[] } };
    };
    expect(schema.$defs.diffCoverage.required).not.toContain("excludedFiles");
  });
});

describe("renderMarkdown: excluded files", () => {
  it("AC-15: summarizes excluded files in a <details> block inside the Diff coverage section", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const two = await reportWith(["schema.gen.ts", "src/generated/api.ts"]);
    expectValidReport(two);
    const md = renderMarkdown(two);
    const block = [
      "<details><summary>Excluded: 2 files</summary>",
      "",
      "- `schema.gen.ts`",
      "- `src/generated/api.ts`",
      "",
      "</details>",
    ].join("\n");
    expect(md).toContain(block);
    const at = md.indexOf(block);
    expect(at).toBeGreaterThan(md.indexOf("| `src/app.ts` | 50% | 1/2 | 2 |"));
    const coverageAt = md.indexOf("### 🧪 Diff coverage");
    const setupAt = md.indexOf("### 🤖 Agent setup (");
    expect(coverageAt).toBeGreaterThanOrEqual(0);
    expect(setupAt).toBeGreaterThanOrEqual(0);
    expect(md.indexOf("| `src/app.ts` |")).toBeGreaterThan(coverageAt);
    expect(at).toBeLessThan(setupAt);

    const one = await reportWith(["src/generated/api.ts"]);
    expectValidReport(one);
    const oneMd = renderMarkdown(one);
    expect(oneMd).toContain("<details><summary>Excluded: 1 file</summary>");
    expect(oneMd).not.toContain("Excluded: 1 files");
    expect(oneMd).toContain("- `src/generated/api.ts`");

    const none = await reportWith(["gen/a.ts", "gen/b.ts"], { noCoverableLines: true });
    expectValidReport(none);
    const noneMd = renderMarkdown(none);
    const noneAt = noneMd.indexOf("<details><summary>Excluded: 2 files</summary>");
    expect(noneAt).toBeGreaterThan(noneMd.indexOf("_No coverable lines changed._"));
    expect(noneMd.indexOf("_No coverable lines changed._")).toBeGreaterThan(-1);
    expect(noneMd.indexOf("### 🤖 Agent setup (")).toBeGreaterThanOrEqual(0);
    expect(noneAt).toBeLessThan(noneMd.indexOf("### 🤖 Agent setup ("));
    expect(noneMd).toContain("- `gen/a.ts`\n- `gen/b.ts`");

    const without = await reportWith(undefined);
    expectValidReport(without);
    expect(renderMarkdown(without)).not.toContain("Excluded:");
  });

  it("AC-16: keeps hostile excluded paths from adding lines, headings or raw HTML", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const hostile = (JSON.parse(fixture("render/hostile-paths.json")) as { repoFiles: string[] }).repoFiles;
    const harmless = hostile.map((_, i) => `gen/harmless${i}.ts`);

    const hostileReport = await reportWith(hostile);
    const harmlessReport = await reportWith(harmless);
    expectValidReport(hostileReport);
    expectValidReport(harmlessReport);
    const md = renderMarkdown(hostileReport);
    const benign = renderMarkdown(harmlessReport);

    // Both list every excluded path, so the comparison below is over rendered paths.
    expect(benign).toContain(`Excluded: ${harmless.length} files`);
    expect(md).toContain(`Excluded: ${hostile.length} files`);

    const lines = md.split("\n");
    expect(lines).toHaveLength(benign.split("\n").length);
    const headings = lines.filter((l) => l.startsWith("## "));
    expect(headings).toHaveLength(1);
    // Line 0 is the fixed logo line, line 1 is empty, and the heading follows.
    const { logoMarkup } = await import("../src/render/logo.js");
    expect(lines[0]).toBe(logoMarkup());
    expect(lines[1]).toBe("");
    expect(headings[0]).toBe(lines[2]);
    // Outside code spans (where GitHub renders it literally), raw HTML must not survive, apart from the logo line.
    expect(
      lines
        .slice(1)
        .join("\n")
        .replace(/`[^`\n]*`/g, ""),
    ).not.toContain("<img");
  });
});
