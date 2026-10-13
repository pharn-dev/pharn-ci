import { isAbsolutePath } from "../paths.js";
import type { CoverageMap } from "./types.js";

export interface CoveragePathMatch {
  /** Distinct file paths in the coverage report. */
  total: number;
  /** Coverage paths that are not tracked files, in code-unit order. */
  unmatched: string[];
  /**
   * A directory the coverage paths look relative to, when none of them matches a tracked file and a whole
   * path-segment suffix match points at one. A suggestion only; never applied.
   */
  suggestedRoot: string | null;
}

/**
 * Compare the (already root-mapped) coverage paths with the tracked files by exact match.
 *
 * `suggestedRoot` is computed only when every path is unmatched, and only from relative ones: every tracked
 * file is walked once and each whole-segment suffix of it that is an unmatched coverage path yields the
 * directory in front of it. When a coverage root is active, a path that starts with it already carries the
 * root, so the directory to suggest is the prefix plus the root. The smallest candidate in code-unit order
 * wins, which keeps the answer deterministic.
 */
export function matchCoveragePaths(
  coverage: CoverageMap,
  repoFiles: readonly string[],
  coverageRoot: string | undefined,
): CoveragePathMatch {
  const tracked = new Set(repoFiles);
  const unmatched = [...coverage.keys()].filter((path) => !tracked.has(path)).sort();
  const total = coverage.size;
  return {
    total,
    unmatched,
    suggestedRoot: unmatched.length === total ? suggestRoot(unmatched, repoFiles, coverageRoot) : null,
  };
}

function suggestRoot(
  unmatched: readonly string[],
  repoFiles: readonly string[],
  coverageRoot: string | undefined,
): string | null {
  const relative = new Set(unmatched.filter((path) => !isAbsolutePath(path)));
  if (relative.size === 0) return null;
  const rootPrefix = coverageRoot === undefined || coverageRoot === "." ? null : `${coverageRoot}/`;

  let best: string | null = null;
  for (const file of repoFiles) {
    for (let i = file.indexOf("/"); i > 0; i = file.indexOf("/", i + 1)) {
      const suffix = file.slice(i + 1);
      if (!relative.has(suffix)) continue;
      const prefix = file.slice(0, i);
      const candidate = rootPrefix !== null && suffix.startsWith(rootPrefix) ? `${prefix}/${coverageRoot}` : prefix;
      if (best === null || candidate < best) best = candidate;
    }
  }
  return best;
}
