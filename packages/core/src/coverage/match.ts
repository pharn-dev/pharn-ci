import { isAbsolutePath, normalizePath } from "../paths.js";
import type { CoverageMap } from "./types.js";

/**
 * Stands in for a backslash while a path is resolved with the backslash read as an ordinary character: it is not a
 * separator, not white space and not `.`, so the resolver leaves it inside its segment. A raw path that already holds
 * one gets no literal key.
 */
const BACKSLASH_STAND_IN = "\u0000";

/**
 * The key a coverage record is stored under before `resolveBackslashPaths` (CORE-101). `raw` is the path as the report
 * writes it, `separated` the key `resolve` gives it (every backslash a separator, as `normalizePath` reads it). When
 * `raw` has a backslash, it is resolved once more with each backslash read as part of a file name; that literal key is
 * returned when it differs from `separated` and `normalizePath` turns it back into `separated`, so a record whose
 * literal key is not tracked ends up exactly where it always did. Any other path keeps `separated`: a name where
 * reading the backslash literally changes how a `..`, a drive letter, the repo root or a Cobertura source resolves is
 * read with backslashes as separators.
 */
export function literalBackslashKey(raw: string, separated: string, resolve: (path: string) => string): string {
  if (!raw.includes("\\") || raw.includes(BACKSLASH_STAND_IN)) return separated;
  const literal = resolve(raw.replace(/\\/g, BACKSLASH_STAND_IN)).split(BACKSLASH_STAND_IN).join("\\");
  return literal !== separated && normalizePath(literal) === separated ? literal : separated;
}

/**
 * Settle the keys a parser stored with `literalBackslashes` against the tracked files (CORE-101). On Linux and macOS a
 * backslash is a legal file-name character, so a key with a backslash that names a tracked file is kept as written;
 * any other key with a backslash is a Windows report's path, and its backslashes become separators (`normalizePath`).
 * A record that lands on a key already in the map is merged with `combine` per line (lcov sums, Cobertura takes the
 * maximum), as the parser would have merged it. Keys keep their first-seen order; the input is not changed, and is
 * returned as it is when no key moves. An empty `tracked` set (git failed) moves every key with a backslash.
 */
export function resolveBackslashPaths(
  coverage: CoverageMap,
  tracked: ReadonlySet<string>,
  combine: (a: number, b: number) => number,
): CoverageMap {
  const moves = (path: string) => path.includes("\\") && !tracked.has(path);
  if (![...coverage.keys()].some(moves)) return coverage;
  const resolved: CoverageMap = new Map();
  for (const [path, lines] of coverage) {
    const key = moves(path) ? normalizePath(path) : path;
    const target = resolved.get(key);
    if (target === undefined) {
      resolved.set(key, new Map(lines));
      continue;
    }
    for (const [line, hits] of lines) {
      const before = target.get(line);
      target.set(line, before === undefined ? hits : combine(before, hits));
    }
  }
  return resolved;
}

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
