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

  it("compares exactly, and never shows a failing percent as reaching the threshold", () => {
    // 2/3 = 66.666...% is below 66.67, so it fails there; shown rounded down as 66.66%, not 66.67%.
    const diff = [file("a.ts", [1, 2, 3])];
    expect(computeDiffCoverage(diff, lcov([1, 1, 0]), 66.67)).toMatchObject({ percent: 66.66, meetsThreshold: false });
    // 66.67% already reads below 66.68, so the usual half-up rounding stays.
    expect(computeDiffCoverage(diff, lcov([1, 1, 0]), 66.68)).toMatchObject({ percent: 66.67, meetsThreshold: false });
    // At or below the true value it passes, and the percent keeps its usual half-up rounding.
    expect(computeDiffCoverage(diff, lcov([1, 1, 0]), 66.66)).toMatchObject({ percent: 66.67, meetsThreshold: true });
  });

  describe("exact threshold comparison (F-31)", () => {
    const many = (coveredCount: number, total: number, threshold: number | null) => {
      const hits = Array.from({ length: total }, (_, i) => (i < coveredCount ? 1 : 0));
      return computeDiffCoverage(
        [
          file(
            "a.ts",
            hits.map((_, i) => i + 1),
          ),
        ],
        lcov(hits),
        threshold,
      );
    };

    it("fails 79.995% at 80 and shows it as 79.99%, not 80%", () => {
      expect(many(15999, 20000, 80)).toMatchObject({ percent: 79.99, meetsThreshold: false });
    });

    it("keeps half-up rounding when no threshold is crossed", () => {
      expect(many(15999, 20000, null)).toMatchObject({ percent: 80, meetsThreshold: true });
      expect(many(15999, 20000, 79.99)).toMatchObject({ percent: 80, meetsThreshold: true });
    });

    it("passes exactly 80% at 80", () => {
      expect(many(16000, 20000, 80)).toMatchObject({ percent: 80, meetsThreshold: true });
      expect(many(4, 5, 80)).toMatchObject({ percent: 80, meetsThreshold: true });
    });

    it("reads decimal thresholds exactly, not as binary floats", () => {
      // Float traps: 801/1000 = 80.1% exactly meets 80.1, 800/1000 does not.
      expect(many(801, 1000, 80.1).meetsThreshold).toBe(true);
      expect(many(800, 1000, 80.1).meetsThreshold).toBe(false);
      expect(many(29, 100, 29)).toMatchObject({ percent: 29, meetsThreshold: true });
      expect(many(57, 100, 57)).toMatchObject({ percent: 57, meetsThreshold: true });
      expect(many(1, 100_000, 0.001).meetsThreshold).toBe(true);
      expect(many(1, 100_001, 0.001).meetsThreshold).toBe(false);
    });

    it("keeps the 0 and 100 clamps", () => {
      expect(many(20000, 20000, 100)).toMatchObject({ percent: 100, meetsThreshold: true });
      expect(many(19999, 20000, 100)).toMatchObject({ percent: 99.99, meetsThreshold: false });
      expect(many(0, 20000, 0)).toMatchObject({ percent: 0, meetsThreshold: true });
      expect(many(0, 20000, 0.01)).toMatchObject({ percent: 0, meetsThreshold: false });
      expect(many(2, 20000, 0.01)).toMatchObject({ percent: 0.01, meetsThreshold: true });
    });

    it("treats threshold 0 as met by any coverage, 0% included", () => {
      expect(many(0, 3, 0)).toMatchObject({ percent: 0, threshold: 0, meetsThreshold: true });
    });
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
