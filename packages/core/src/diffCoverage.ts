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
  /** true when no threshold is set, there are no coverable lines, or percent >= threshold. */
  meetsThreshold: boolean;
}

/**
 * Coverage of added lines. An added line counts only if the coverage report
 * knows it (it is "coverable"); unknown lines are excluded from the denominator.
 * A threshold is inclusive and compared against the percent rounded to 2
 * decimals: exactly equal passes.
 */
export function computeDiffCoverage(
  diff: readonly DiffFile[],
  coverage: CoverageMap,
  threshold: number | null,
): DiffCoverageResult {
  const files: DiffCoverageFile[] = [];
  let covered = 0;
  let coverable = 0;

  for (const file of diff) {
    if (file.status === "deleted") continue;
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

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const percent = percentOf(covered, coverable);
  return {
    percent,
    threshold,
    coveredLines: covered,
    coverableLines: coverable,
    files,
    // Compare the reported (rounded) percent so the verdict always agrees with what users see.
    meetsThreshold: threshold === null || percent === null || percent >= threshold,
  };
}

/** Percent rounded to 2 decimals; 100 and 0 are reserved for exactly all / none covered. */
function percentOf(covered: number, total: number): number | null {
  if (total === 0) return null;
  const rounded = Math.round((covered / total) * 10000) / 100;
  return Math.min(Math.max(rounded, covered > 0 ? 0.01 : 0), covered < total ? 99.99 : 100);
}
