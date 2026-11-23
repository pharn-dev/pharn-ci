/** Hit counts per 1-based line number, for one file. */
export type LineHits = Map<number, number>;

/**
 * Repo-relative POSIX path -> line hits. A line present in the map is
 * "coverable"; it is covered when its hit count is > 0.
 */
export type CoverageMap = Map<string, LineHits>;

/** A parsed coverage report with the number of malformed records the parser dropped from it. */
export interface ParsedCoverage {
  map: CoverageMap;
  skipped: number;
}

export type CoverageFormat = "lcov" | "cobertura";

/** What the user may ask for: one of the formats, or `auto` to detect it from the start of the file. */
export type CoverageFormatSelection = CoverageFormat | "auto";

export const COVERAGE_FORMAT_SELECTIONS: readonly CoverageFormatSelection[] = ["lcov", "cobertura", "auto"];

export interface ParseCoverageOptions {
  /** Absolute repo root; used to turn absolute report paths into repo-relative ones. */
  repoRoot?: string;
  /**
   * Repo-relative directory joined in front of paths that are relative as written (package-relative
   * coverage in a monorepo). Never applied to an absolute path. Absent or `.` means the repo root.
   */
  coverageRoot?: string;
  /**
   * Keep a backslash that may be part of a file name (CORE-101). When true, a path with a backslash is keyed by its
   * literal form (the backslash read as an ordinary character, every other step as usual) whenever that form reads
   * back to the separator form under `normalizePath`; `resolveBackslashPaths` then keeps the literal key only when it
   * is a tracked file. `check()` and the CLI and Action readers set it. Absent or false: a backslash is always a
   * separator, as before.
   */
  literalBackslashes?: boolean;
}
