/** Hit counts per 1-based line number, for one file. */
export type LineHits = Map<number, number>;

/**
 * Repo-relative POSIX path -> line hits. A line present in the map is
 * "coverable"; it is covered when its hit count is > 0.
 */
export type CoverageMap = Map<string, LineHits>;

export type CoverageFormat = "lcov" | "cobertura";

export const COVERAGE_FORMATS: readonly CoverageFormat[] = ["lcov", "cobertura"];

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
}
