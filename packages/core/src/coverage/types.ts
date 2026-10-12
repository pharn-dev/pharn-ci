/** Hit counts per 1-based line number, for one file. */
export type LineHits = Map<number, number>;

/**
 * Repo-relative POSIX path -> line hits. A line present in the map is
 * "coverable"; it is covered when its hit count is > 0.
 */
export type CoverageMap = Map<string, LineHits>;

export type CoverageFormat = "lcov" | "cobertura";

export const COVERAGE_FORMATS: readonly CoverageFormat[] = ["lcov", "cobertura"];

export interface ParseCoverageOptions {
  /** Absolute repo root; used to turn absolute report paths into repo-relative ones. */
  repoRoot?: string;
}
