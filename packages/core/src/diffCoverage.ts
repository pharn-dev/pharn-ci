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
  /** true when no threshold is set, there are no coverable lines, or percent >= threshold. */
  meetsThreshold: boolean;
}

/**
 * Coverage of added lines. An added line counts only if the coverage report
 * knows it (it is "coverable"); unknown lines are excluded from the denominator.
 * A threshold is inclusive and compared against the percent rounded to 2
 * decimals: exactly equal passes. A changed file that `isExcluded` (by its new path) is left out of
 * every count and listed in `excludedFiles`, whether or not the coverage report knows it.
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
  const percent = percentOf(covered, coverable);
  return {
    percent,
    threshold,
    coveredLines: covered,
    coverableLines: coverable,
    files,
    ...(excluded.size > 0 ? { excludedFiles: [...excluded].sort(byPath) } : {}),
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
