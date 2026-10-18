import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const repoFiles = fixture("golden/files.txt").trim().split("\n");

function goldenReport(threshold: number | null) {
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold,
    repoFiles,
  });
}

describe("golden: fixture diff + lcov -> Report v1", () => {
  it("matches the expected report JSON and the schema", async () => {
    const report = goldenReport(80);
    expectValidReport(report);
    await expect(`${JSON.stringify(report, null, 2)}\n`).toMatchFileSnapshot("../../../fixtures/golden/report.json");
  });

  it("renders the expected markdown", async () => {
    await expect(renderMarkdown(goldenReport(80))).toMatchFileSnapshot("../../../fixtures/golden/report.md");
  });

  it("passes with a lower threshold", () => {
    const report = goldenReport(70);
    expect(report.verdict).toBe("pass");
    expect(report.diffCoverage?.percent).toBe(71.43);
  });

  it("reports a missing coverage file", () => {
    const report = check({
      version: "0.1.0",
      coverage: { missingFile: "coverage/lcov.info" },
      diff: { text: fixture("golden/pr.diff") },
      threshold: 80,
      repoFiles,
    });
    expectValidReport(report);
    expect(report.verdict).toBe("fail");
    expect(report.messages.map((m) => m.code)).toEqual(["COVERAGE_FILE_MISSING"]);
  });

  it.each([
    ["lcov/empty.info", 80, "fail", "error"],
    ["lcov/garbage.info", 80, "fail", "error"],
    ["lcov/no-lines.info", 80, "fail", "error"],
    ["lcov/empty.info", null, "warn", "warn"],
  ] as const)(
    "reports %s (threshold %s) as COVERAGE_FILE_EMPTY instead of passing",
    (file, threshold, verdict, level) => {
      const report = check({
        version: "0.1.0",
        coverage: { text: fixture(file), format: "lcov", file: "coverage/lcov.info" },
        diff: { text: fixture("golden/pr.diff") },
        threshold,
        repoFiles,
      });
      expectValidReport(report);
      expect(report.verdict).toBe(verdict);
      expect(report.diffCoverage).toBeNull();
      expect(report.messages).toEqual([
        {
          level,
          code: "COVERAGE_FILE_EMPTY",
          text: "Coverage file coverage/lcov.info contains no coverage records; check its format and that the tests wrote it.",
        },
      ]);
    },
  );

  it("passes an empty diff with NO_COVERABLE_CHANGES", () => {
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("diff/empty.diff") },
      threshold: 100,
      repoFiles: [],
    });
    expectValidReport(report);
    expect(report.verdict).toBe("pass");
    expect(report.messages.map((m) => m.code)).toEqual(["NO_COVERABLE_CHANGES", "NO_AGENT_SETUP_FILES"]);
  });

  it("fails when the diff is unavailable and a threshold is set", () => {
    const report = check({
      version: "0.1.0",
      coverage: { text: "", format: "lcov" },
      diff: { unavailable: "no base" },
      threshold: 80,
      repoFiles,
    });
    expectValidReport(report);
    expect(report.verdict).toBe("fail");
  });
});
