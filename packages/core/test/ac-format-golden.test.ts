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
// ai-agnostic-inventory (F-11) then updated both hashes on purpose: AGENTS.md is now credited to four more tools
// (amp, jules, opencode, zed), so the golden's `Agent setup:` line and `agentSetup.summary.tools` changed.
// The pr-comment-redesign-2 feature then updated the markdown hash on purpose: the render gained a summary table
// under the verdict heading; the JSON report, and so its hash, did not change.
// The pr-comment-bold-look feature then updated the markdown hash on purpose: the render changed its header, section
// headings, collapsing and footer. The golden and golden-cobertura markdown now differ only by the footer's coverage
// format; the JSON report, and so its hash, did not change.
const GOLDEN_MD_SHA256 = "b61cd0d636dd1f9e53756354f6ed7b17b8e9b2001a535491912ed619e970591d";
const GOLDEN_JSON_SHA256 = "a455705f65d678d9c059231ba36bed7241155cd5063744d2effd8df8d8116c24";

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
    // The two renders differ in exactly one line, the footer, which names the coverage format.
    const lastLine = (markdown: string) => markdown.trimEnd().split("\n").at(-1);
    const withoutFooter = (markdown: string) => markdown.trimEnd().split("\n").slice(0, -1);
    expect(withoutFooter(renderMarkdown(report))).toEqual(withoutFooter(renderMarkdown(lcovReport)));
    expect(lastLine(renderMarkdown(report))).toBe(
      "<sub>pharn-ci 0.1.0 · report schema v1 · coverage format cobertura</sub>",
    );
    expect(lastLine(renderMarkdown(lcovReport))).toBe(
      "<sub>pharn-ci 0.1.0 · report schema v1 · coverage format lcov</sub>",
    );

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
