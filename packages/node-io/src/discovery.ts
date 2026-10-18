import {
  type CheckInput,
  COVERAGE_DISCOVERY_CANDIDATES,
  ConfigError,
  type CoverageDiscovery,
  type CoverageFormatSelection,
  chooseDiscoveredCoverage,
  coverageDiscoveryAmbiguousText,
  coverageDiscoveryLimitText,
  coverageDiscoveryLine,
  MAX_COVERAGE_GLOB_FILES,
  MAX_COVERAGE_WALK_ENTRIES,
  type WalkBudget,
  WalkLimitError,
  walkGlob,
} from "@pharn-ci/core";
import { type CoverageReadDeps, readCoverageFiles } from "./coverage.js";

/**
 * Look for a coverage report at the discovery candidates under `repoRoot`: every candidate is walked with the
 * pure glob walk over the real directory listing, which reports a link as a link and never follows it, so only
 * regular files count. The walks share one budget (the coverage glob limits) and the paths they find go through
 * core's choice rule, so this and `chooseDiscoveredCoverage` are one rule. Going over a limit throws a ConfigError.
 */
export async function discoverCoverage(
  deps: Pick<CoverageReadDeps, "listDir" | "resolvePath">,
  repoRoot: string,
): Promise<CoverageDiscovery> {
  const budget: WalkBudget = { files: 0, entries: 0 };
  const limits = { files: MAX_COVERAGE_GLOB_FILES, entries: MAX_COVERAGE_WALK_ENTRIES };
  const listDir = (dir: string) => deps.listDir(deps.resolvePath(repoRoot, dir));
  const existing: string[] = [];
  try {
    for (const candidate of COVERAGE_DISCOVERY_CANDIDATES) {
      existing.push(...(await walkGlob(candidate, listDir, budget, limits)));
    }
  } catch (err) {
    if (err instanceof WalkLimitError) throw new ConfigError(coverageDiscoveryLimitText(err.limit));
    throw err;
  }
  return chooseDiscoveredCoverage(existing);
}

export interface ReadDiscoveredCoverageOptions {
  /** Absolute repo root: where candidates are looked for and what discovered paths are relative to. */
  repoRoot: string;
  format: CoverageFormatSelection;
  coverageRoot?: string;
  /** The adapter's own way to set the coverage path, appended to the error for an ambiguous discovery. */
  howToSet: string;
  /** Called with each log line: the `(auto-discovered)` line per file, then the format line per file. */
  log(line: string): void;
}

/**
 * Discover the coverage report and read it, for an adapter with no coverage path set. Several kinds of report
 * found throws a ConfigError naming them all; none found resolves the not-found value, which `check()` reports;
 * otherwise each file is logged as auto-discovered and read (named repo-relative, taken as a literal path).
 */
export async function readDiscoveredCoverage(
  deps: CoverageReadDeps,
  options: ReadDiscoveredCoverageOptions,
): Promise<CheckInput["coverage"]> {
  const { repoRoot, format, coverageRoot, howToSet, log } = options;
  const discovery = await discoverCoverage(deps, repoRoot);
  if (discovery.kind === "ambiguous") {
    throw new ConfigError(coverageDiscoveryAmbiguousText(discovery.found, howToSet));
  }
  if (discovery.kind === "not-found") return discovery;
  for (const path of discovery.files) log(coverageDiscoveryLine(path));
  const files = await readCoverageFiles(deps, {
    entries: discovery.files,
    label: "coverage auto-discovery",
    baseDir: repoRoot,
    format,
    repoRoot,
    ...(coverageRoot === undefined ? {} : { coverageRoot }),
    name: (entry) => entry,
    log,
    literal: true,
  });
  return { files, format };
}
