import { describe, expect, it } from "vitest";
import { parseLcov } from "../src/coverage/lcov.js";
import type { DiffFile } from "../src/diff/unified.js";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import { computeDiffCoverage } from "../src/diffCoverage.js";
import { fixture } from "./helpers.js";

const file = (path: string, addedLines: number[], status: DiffFile["status"] = "modified"): DiffFile => ({
  path,
  oldPath: path,
  status,
  addedLines,
});

/** lcov where line N of a.ts has hits[N-1]. */
const lcov = (hits: number[]) =>
  parseLcov(`SF:a.ts\n${hits.map((h, i) => `DA:${i + 1},${h}`).join("\n")}\nend_of_record\n`);

describe("computeDiffCoverage", () => {
  it("measures added lines from fixtures", () => {
    const diff = parseUnifiedDiff(fixture("diff/modified-multi-hunk.diff"));
    const result = computeDiffCoverage(diff, parseLcov(fixture("lcov/relative.info")), null);
    expect(result).toEqual({
      percent: 50,
      threshold: null,
      coveredLines: 2,
      coverableLines: 4,
      files: [{ path: "src/math.ts", percent: 50, coveredLines: 2, coverableLines: 4, uncoveredLines: [4, 5] }],
      meetsThreshold: true,
    });
  });

  it("excludes added lines unknown to the coverage report from the denominator", () => {
    const result = computeDiffCoverage([file("a.ts", [1, 2, 50, 51])], lcov([1, 0]), null);
    expect(result.coverableLines).toBe(2);
    expect(result.coveredLines).toBe(1);
    expect(result.percent).toBe(50);
  });

  it("excludes files the coverage report does not know", () => {
    const result = computeDiffCoverage([file("README.md", [1, 2]), file("a.ts", [1])], lcov([1]), null);
    expect(result.files.map((f) => f.path)).toEqual(["a.ts"]);
    expect(result.percent).toBe(100);
  });

  it("ignores deleted files even if coverage still lists them", () => {
    const result = computeDiffCoverage([file("a.ts", [1], "deleted")], lcov([0]), 80);
    expect(result.coverableLines).toBe(0);
  });

  it("returns null percent and meets any threshold with zero coverable lines", () => {
    const result = computeDiffCoverage([], lcov([1]), 100);
    expect(result).toMatchObject({ percent: null, coverableLines: 0, files: [], meetsThreshold: true });
  });

  it("passes when exactly equal to the threshold (inclusive boundary)", () => {
    // 4/5 = 80%
    const diff = [file("a.ts", [1, 2, 3, 4, 5])];
    expect(computeDiffCoverage(diff, lcov([1, 1, 1, 1, 0]), 80).meetsThreshold).toBe(true);
    expect(computeDiffCoverage(diff, lcov([1, 1, 1, 1, 0]), 80.01).meetsThreshold).toBe(false);
    expect(computeDiffCoverage(diff, lcov([1, 1, 1, 0, 0]), 80).meetsThreshold).toBe(false);
  });

  it("is not fooled by float rounding at the boundary", () => {
    // 7/100 = 7%, where 0.07 * 100 === 7.000000000000001 in floating point.
    const hits = Array.from({ length: 100 }, (_, i) => (i < 7 ? 1 : 0));
    const diff = [
      file(
        "a.ts",
        hits.map((_, i) => i + 1),
      ),
    ];
    const result = computeDiffCoverage(diff, lcov(hits), 7);
    expect(result.percent).toBe(7);
    expect(result.meetsThreshold).toBe(true);
  });

  it("compares the rounded percent, so the verdict matches the displayed number", () => {
    // 2/3 = 66.666...% is reported as 66.67%, which meets a 66.67 threshold.
    const diff = [file("a.ts", [1, 2, 3])];
    expect(computeDiffCoverage(diff, lcov([1, 1, 0]), 66.67).meetsThreshold).toBe(true);
    expect(computeDiffCoverage(diff, lcov([1, 1, 0]), 66.68).meetsThreshold).toBe(false);
  });

  it("rounds percent to two decimals", () => {
    const result = computeDiffCoverage([file("a.ts", [1, 2, 3])], lcov([1, 1, 0]), null);
    expect(result.percent).toBe(66.67);
  });

  it("never rounds to 100% with uncovered lines, or to 0% with covered lines", () => {
    const many = (coveredCount: number, total: number) => {
      const hits = Array.from({ length: total }, (_, i) => (i < coveredCount ? 1 : 0));
      return computeDiffCoverage(
        [
          file(
            "a.ts",
            hits.map((_, i) => i + 1),
          ),
        ],
        lcov(hits),
        100,
      );
    };
    expect(many(29999, 30000)).toMatchObject({ percent: 99.99, meetsThreshold: false });
    expect(many(1, 30000).percent).toBe(0.01);
    expect(many(0, 3).percent).toBe(0);
  });

  it("sorts files by path and dedupes lines", () => {
    const coverage = parseLcov("SF:b.ts\nDA:1,0\nend_of_record\nSF:a.ts\nDA:1,1\nend_of_record\n");
    const result = computeDiffCoverage([file("b.ts", [1, 1]), file("a.ts", [1])], coverage, null);
    expect(result.files.map((f) => [f.path, f.coverableLines])).toEqual([
      ["a.ts", 1],
      ["b.ts", 1],
    ]);
  });
});
