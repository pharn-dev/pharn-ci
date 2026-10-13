import type { CoverageMap } from "./coverage/types.js";
import type { DiffFile } from "./diff/unified.js";

export interface DiffCoverageFile {
  path: string;
  percent: number | null;
  coveredLines: number;
  coverableLines: number;
  uncoveredLines: number[];
}

export interface DiffCoverageResult {
  percent: number | null;
  threshold: number | null;
  coveredLines: number;
  coverableLines: number;
  files: DiffCoverageFile[];
  /** Changed files left out because an exclusion pattern matched; sorted, present only when non-empty. */
  excludedFiles?: string[];
  /**
   * true when no threshold is set, there are no coverable lines, or covered / coverable >= threshold / 100,
   * compared exactly (not on the rounded percent).
   */
  meetsThreshold: boolean;
}

/**
 * Coverage of added lines. An added line counts only if the coverage report
 * knows it (it is "coverable"); unknown lines are excluded from the denominator.
 * A threshold is inclusive and compared exactly against covered / coverable: exactly equal passes,
 * and 15,999 of 20,000 (79.995%) fails at 80. The reported percent is rounded to 2 decimals, except
 * that a coverage below the threshold is rounded down rather than up to it, so the shown number
 * never reaches a threshold the coverage failed. Threshold 0 gates nothing (any coverage meets it);
 * buildReport says so with DIFF_COVERAGE_UNGATED. A changed file that `isExcluded` (by its new path)
 * is left out of every count and listed in `excludedFiles`, whether or not the coverage report knows it.
 */
export function computeDiffCoverage(
  diff: readonly DiffFile[],
  coverage: CoverageMap,
  threshold: number | null,
  isExcluded: (path: string) => boolean = () => false,
): DiffCoverageResult {
  const files: DiffCoverageFile[] = [];
  const excluded = new Set<string>();
  let covered = 0;
  let coverable = 0;

  for (const file of diff) {
    if (file.status === "deleted") continue;
    if (isExcluded(file.path)) {
      excluded.add(file.path);
      continue;
    }
    const hits = coverage.get(file.path);
    if (!hits) continue;
    let fileCovered = 0;
    let fileCoverable = 0;
    const uncovered: number[] = [];
    for (const line of new Set(file.addedLines)) {
      const h = hits.get(line);
      if (h === undefined) continue;
      fileCoverable++;
      if (h > 0) fileCovered++;
      else uncovered.push(line);
    }
    if (fileCoverable === 0) continue;
    covered += fileCovered;
    coverable += fileCoverable;
    files.push({
      path: file.path,
      percent: percentOf(fileCovered, fileCoverable),
      coveredLines: fileCovered,
      coverableLines: fileCoverable,
      uncoveredLines: uncovered.sort((a, b) => a - b),
    });
  }

  const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  files.sort((a, b) => byPath(a.path, b.path));
  const meetsThreshold = threshold === null || coverable === 0 || atLeast(covered, coverable, threshold);
  let percent = percentOf(covered, coverable);
  if (!meetsThreshold && percent !== null && threshold !== null && percent >= threshold) {
    // Rounding up would show e.g. 80% for a 79.995% that fails a threshold of 80: show 79.99% instead.
    percent = percentOf(covered, coverable, Math.floor);
  }
  return {
    percent,
    threshold,
    coveredLines: covered,
    coverableLines: coverable,
    files,
    ...(excluded.size > 0 ? { excludedFiles: [...excluded].sort(byPath) } : {}),
    meetsThreshold,
  };
}

/** Percent rounded to 2 decimals; 100 and 0 are reserved for exactly all / none covered. */
function percentOf(covered: number, total: number, round: (n: number) => number = Math.round): number | null {
  if (total === 0) return null;
  const rounded = round((covered * 10000) / total) / 100;
  return Math.min(Math.max(rounded, covered > 0 ? 0.01 : 0), covered < total ? 99.99 : 100);
}

/**
 * Exactly whether covered / total >= threshold / 100, in integer arithmetic: the threshold is read
 * as the decimal it was written as (String(80.1) is "80.1", so 801 / 10), never as a binary float.
 */
function atLeast(covered: number, total: number, threshold: number): boolean {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(threshold));
  if (m === null) return covered * 100 >= threshold * total; // unreachable for a finite threshold >= 0
  const fraction = m[2] ?? "";
  const scale = fraction.length - Number(m[3] ?? 0);
  const digits = BigInt(`${m[1]}${fraction}`);
  // covered * 100 >= digits * 10^-scale * total, with both sides multiplied by 10^|scale| as needed.
  const left = BigInt(covered) * 100n * 10n ** BigInt(Math.max(scale, 0));
  const right = digits * BigInt(total) * 10n ** BigInt(Math.max(-scale, 0));
  return left >= right;
}
