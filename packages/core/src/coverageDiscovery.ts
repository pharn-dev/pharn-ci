import { compileGlob } from "./glob.js";

/**
 * Coverage auto-discovery: which coverage report a run reads when no path is set (no `--coverage` flag, no
 * `coverage-file` input, no `coverage.file`). Pure: the existence checks and the directory walk live in the
 * adapters' shared Node I/O; this module holds the candidate list, the choice rule and the wording.
 */

/**
 * The places a coverage report is looked for, in the order they are listed in messages. The last entry is a
 * glob (the .NET coverlet default, whose folder is a fresh id per run); the others are literal repo-relative
 * paths. A match must be a regular file: a directory or a symbolic link at a candidate path does not count.
 */
export const COVERAGE_DISCOVERY_CANDIDATES: readonly string[] = Object.freeze([
  "coverage/lcov.info",
  "lcov.info",
  "coverage.xml",
  "coverage/cobertura-coverage.xml",
  "**/coverage.cobertura.xml",
]);

/** No candidate exists. Also the value `check()` takes to report it. */
export type CoverageDiscoveryNotFound = { kind: "not-found" };

/**
 * The outcome of a discovery:
 * - `found`: exactly one candidate has matches; `files` are the matched files (several only for the glob),
 *   sorted in code-unit order.
 * - `ambiguous`: two or more candidates have matches; `found` lists every matched path, candidates in list
 *   order. No file is chosen.
 * - `not-found`: nothing matched.
 */
export type CoverageDiscovery =
  | { kind: "found"; files: string[] }
  | { kind: "ambiguous"; found: string[] }
  | CoverageDiscoveryNotFound;

const GLOB_CANDIDATE = "**/coverage.cobertura.xml";
const matchesGlobCandidate = compileGlob(GLOB_CANDIDATE);

/** Whether a path is below `.git` or `node_modules`, the directories the discovery walk never enters. */
function inSkippedDirectory(path: string): boolean {
  return path.split("/").some((segment) => segment === ".git" || segment === "node_modules");
}

/** Code-unit order, like `Array.prototype.sort` without a comparator. */
function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The choice rule over any set of existing repo-relative paths (forward slashes). One candidate kind with
 * matches is the answer, several kinds are ambiguous, none is not-found. Paths are de-duplicated.
 */
export function chooseDiscoveredCoverage(paths: Iterable<string>): CoverageDiscovery {
  const present = new Set(paths);
  const kinds: string[][] = [];
  for (const candidate of COVERAGE_DISCOVERY_CANDIDATES) {
    if (candidate === GLOB_CANDIDATE) {
      const matches = [...present]
        .filter((path) => !inSkippedDirectory(path) && matchesGlobCandidate(path))
        .sort(codeUnitOrder);
      if (matches.length > 0) kinds.push(matches);
    } else if (present.has(candidate)) {
      kinds.push([candidate]);
    }
  }
  const [only] = kinds;
  if (only === undefined) return { kind: "not-found" };
  if (kinds.length === 1) return { kind: "found", files: only };
  return { kind: "ambiguous", found: kinds.flat() };
}

/** The line an adapter prints for a file it chose by discovery. */
export function coverageDiscoveryLine(path: string): string {
  return `coverage: ${path} (auto-discovered)`;
}

/** The error for an ambiguous discovery; `howToSet` is the adapter's own way to set the path. */
export function coverageDiscoveryAmbiguousText(found: readonly string[], howToSet: string): string {
  return `found more than one coverage report (${found.join(", ")}), so none was chosen: ${howToSet}`;
}

/** The report text when no candidate exists. */
export function coverageNotDiscoveredText(): string {
  return `No coverage report was found. Looked for: ${COVERAGE_DISCOVERY_CANDIDATES.join(", ")}. Set coverage.file in .pharn/ci.yml, the coverage-file input or --coverage to point at your report.`;
}

/** The error for a discovery walk that went over a limit; worded like the glob walk's own messages. */
export function coverageDiscoveryLimitText(limit: "files" | "entries"): string {
  return limit === "files"
    ? "coverage auto-discovery matched more than 1,000 files; set the coverage path (coverage.file, the coverage-file input or --coverage)"
    : "coverage auto-discovery: the walk limit was exceeded (more than 100,000 directory entries visited in one run); set the coverage path (coverage.file, the coverage-file input or --coverage)";
}
