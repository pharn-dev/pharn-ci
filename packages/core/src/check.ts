import { parseCoverageRoot, parseExcludePattern } from "./config.js";
import { chooseCoverageFormat } from "./coverage/detect.js";
import { parseCoverage } from "./coverage/index.js";
import { matchCoveragePaths } from "./coverage/match.js";
import type { CoverageFormatSelection } from "./coverage/types.js";
import { parseUnifiedDiff } from "./diff/unified.js";
import { computeDiffCoverage } from "./diffCoverage.js";
import { compileGlob } from "./glob.js";
import { buildReport, type Report } from "./report.js";
import { scanAgentSetup } from "./setup/scan.js";

export interface CheckInput {
  version: string;
  /**
   * Coverage report contents (and, optionally, the path it was read from, for messages), or the
   * path that was looked for when it is missing.
   */
  coverage: { text: string; format: CoverageFormatSelection; file?: string } | { missingFile: string };
  /** Unified diff text, or why no diff is available. */
  diff: { text: string } | { unavailable: string };
  /** Absolute repo root, used to relativize absolute coverage paths. */
  repoRoot?: string;
  threshold: number | null;
  /** Repo-relative tracked paths (e.g. `git ls-files`). */
  repoFiles: readonly string[];
  /**
   * Glob patterns of changed files to leave out of diff coverage, from every source (config, flag, input) in
   * any order. Validated and de-duplicated here; an unsupported pattern throws a ConfigError.
   */
  exclude?: readonly string[];
  /** When true, a repo with no agent setup files fails the check. Off when absent. */
  requireAgentSetup?: boolean;
  /**
   * Repo-relative directory that relative coverage paths start from (package-relative coverage in a
   * monorepo). Validated here; an invalid value throws a ConfigError. Absent means the repo root.
   */
  coverageRoot?: string;
}

/** The whole pharn-ci check as one pure function: raw inputs in, Report v1 out. */
export function check(input: CheckInput): Report {
  // Validate before any early return, so a bad pattern is an error even when nothing else is computed.
  const matchers = [...new Set((input.exclude ?? []).map((p) => parseExcludePattern(p)))].map(compileGlob);
  const isExcluded = (path: string) => matchers.some((matches) => matches(path));
  const coverageRoot =
    input.coverageRoot === undefined ? undefined : parseCoverageRoot(input.coverageRoot, "coverage root");
  const agentSetup = scanAgentSetup(input.repoFiles);
  const base = {
    version: input.version,
    threshold: input.threshold,
    agentSetup,
    requireAgentSetup: input.requireAgentSetup === true,
  };

  if ("missingFile" in input.coverage) {
    return buildReport({
      ...base,
      diffCoverage: null,
      missing: { reason: "coverage-file-missing", coverageFile: input.coverage.missingFile },
    });
  }
  if ("unavailable" in input.diff) {
    return buildReport({
      ...base,
      diffCoverage: null,
      missing: { reason: "diff-unavailable", detail: input.diff.unavailable },
    });
  }

  const coverageFile = input.coverage.file ?? null;
  const choice = chooseCoverageFormat(input.coverage.text, input.coverage.format);
  if (choice.format === "empty") {
    return buildReport({
      ...base,
      diffCoverage: null,
      missing: { reason: "coverage-file-empty", coverageFile },
    });
  }
  if (choice.format === "unknown") {
    return buildReport({
      ...base,
      diffCoverage: null,
      missing: { reason: "coverage-format-unsupported", coverageFile },
    });
  }

  const coverage = parseCoverage(input.coverage.text, choice.format, {
    ...(input.repoRoot === undefined ? {} : { repoRoot: input.repoRoot }),
    ...(coverageRoot === undefined ? {} : { coverageRoot }),
  });
  // An empty or unreadable report would otherwise make every change look uncovered-but-untracked
  // and pass as NO_COVERABLE_CHANGES. Say so instead.
  if (coverage.size === 0) {
    return buildReport({
      ...base,
      diffCoverage: null,
      missing: { reason: "coverage-file-empty", coverageFile },
    });
  }
  // Coverage paths are compared with the tracked files by exact match. A report whose paths match none of
  // them would otherwise make every change look untracked and pass as NO_COVERABLE_CHANGES. An empty
  // tracked-files list (git failed) cannot be compared, so both checks are skipped then.
  let untrackedCoveragePaths = 0;
  if (input.repoFiles.length > 0) {
    const match = matchCoveragePaths(coverage, input.repoFiles, coverageRoot);
    if (match.unmatched.length === match.total) {
      return buildReport({
        ...base,
        diffCoverage: null,
        missing: {
          reason: "coverage-paths-unmatched",
          total: match.total,
          example: match.unmatched[0] ?? "",
          suggestedRoot: match.suggestedRoot,
        },
      });
    }
    untrackedCoveragePaths = match.unmatched.length;
  }
  const diff = parseUnifiedDiff(input.diff.text);
  return buildReport({
    ...base,
    coverageFormat: choice.format,
    diffCoverage: computeDiffCoverage(diff, coverage, input.threshold, isExcluded),
    ...(untrackedCoveragePaths > 0 ? { untrackedCoveragePaths } : {}),
  });
}
