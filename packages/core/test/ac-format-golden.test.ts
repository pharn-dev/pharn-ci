import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the renderer and the fixtures are loaded inside each test body: the AC tests are written before format
// selection and fixtures/golden-cobertura/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

// sha256 of fixtures/golden/report.md and fixtures/golden/report.json as committed before this change. The
// markdown hash was updated by F-32, which intentionally changed the rendering (file rows sorted by coverage,
// a hint line under each message); the JSON report, and so its hash, did not change.
const GOLDEN_MD_SHA256 = "5094fad628951a453a0a436279c9c19850e5bfa8703fcd13db3a823c632f45ad";
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

    const markdown = fixture("golden/report.md");
    expect(sha256(markdown)).toBe(GOLDEN_MD_SHA256);
    expect(renderMarkdown(report)).toBe(markdown);

    const json = fixture("golden/report.json");
    expect(asFile(report)).toBe(json);
    const committed = JSON.parse(json);
    expect(committed.diffCoverage.format).toBe("lcov");
    const { format: _format, ...previousDiffCoverage } = committed.diffCoverage;
    expect(sha256(asFile({ ...committed, diffCoverage: previousDiffCoverage }))).toBe(GOLDEN_JSON_SHA256);
  });
});
