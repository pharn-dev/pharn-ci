import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the renderer and the fixtures are loaded inside each test body: the AC tests are written before format
// selection and fixtures/golden-cobertura/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

// sha256 of fixtures/golden/report.md and fixtures/golden/report.json as committed before this change. The
// markdown hash was updated by F-32, which intentionally changed the rendering (file rows sorted by coverage,
// a hint line under each message); the JSON report, and so its hash, did not change. F-16 changed the rendering
// again on purpose, moving `### Messages` above `### Agent setup`, so the markdown hash changed once more.
const GOLDEN_MD_SHA256 = "625c0fe399c49aca5aabdc560db4a1e412fac63d07c29d47b74e30c3b2783d43";
const GOLDEN_JSON_SHA256 = "e3be10a5b1d4f03a3aa5d3b1f97651432fc4ea9bcba51b853dace36b05111419";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;

async function load() {
  const { check } = await import("../src/check.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  return { check, renderMarkdown };
}

describe("golden reports and the coverage format", () => {
  it("AC-13: the golden Cobertura inputs give the expected report and markdown", async () => {
    const { check, renderMarkdown } = await load();
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" },
      diff: { text: fixture("golden-cobertura/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden-cobertura/files.txt").trim().split("\n"),
    });
    // Asserted before the file snapshots, so a run that would write a missing snapshot still fails here first.
    expectValidReport(report);
    expect(report.diffCoverage?.format).toBe("cobertura");

    // The Cobertura translation of the lcov golden gives the lcov golden report, except for the format.
    const lcovReport = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expect(report).toEqual({ ...lcovReport, diffCoverage: { ...lcovReport.diffCoverage, format: "cobertura" } });
    expect(renderMarkdown(report)).toBe(renderMarkdown(lcovReport));

    await expect(asFile(report)).toMatchFileSnapshot("../../../fixtures/golden-cobertura/report.json");
    await expect(renderMarkdown(report)).toMatchFileSnapshot("../../../fixtures/golden-cobertura/report.md");
  });

  it("AC-14: the lcov golden markdown is unchanged and its JSON gains only diffCoverage.format lcov", async () => {
    const { check, renderMarkdown } = await load();
    // The same inputs packages/core/test/golden.test.ts writes fixtures/golden/ from.
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(report);

    // The golden coverage names src/legacy.ts, which its tracked files lack, so the golden gained exactly one
    // COVERAGE_PATHS_PARTIALLY_UNMATCHED info message on purpose (coverage path mapping). Taking that one message
    // out (in the markdown, its bullet and the hint line F-32 renders under it) gives back the output the pinned
    // hashes were taken from.
    const partialCode = "COVERAGE_PATHS_PARTIALLY_UNMATCHED";
    const markdown = fixture("golden/report.md");
    expect(renderMarkdown(report)).toBe(markdown);
    const markdownLines = markdown.split("\n");
    expect(markdownLines.filter((line) => line.includes(`\`${partialCode}\``))).toHaveLength(1);
    const partialAt = markdownLines.findIndex((line) => line.includes(`\`${partialCode}\``));
    expect(markdownLines[partialAt + 1]).toMatch(/^ {2}- Hint: \S/);
    const markdownWithoutMessage = markdownLines
      .filter((_, index) => index !== partialAt && index !== partialAt + 1)
      .join("\n");
    expect(sha256(markdownWithoutMessage)).toBe(GOLDEN_MD_SHA256);

    const json = fixture("golden/report.json");
    expect(asFile(report)).toBe(json);
    const committed = JSON.parse(json);
    expect(committed.diffCoverage.format).toBe("lcov");
    const partialMessages = committed.messages.filter((message: { code: string }) => message.code === partialCode);
    expect(partialMessages).toHaveLength(1);
    expect(partialMessages[0].level).toBe("info");
    const { format: _format, ...previousDiffCoverage } = committed.diffCoverage;
    const messagesWithoutPartial = committed.messages.filter(
      (message: { code: string }) => message.code !== partialCode,
    );
    expect(sha256(asFile({ ...committed, diffCoverage: previousDiffCoverage, messages: messagesWithoutPartial }))).toBe(
      GOLDEN_JSON_SHA256,
    );
  });
});
