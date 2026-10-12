import { parseExcludePattern } from "./config.js";
import { parseCoverage } from "./coverage/index.js";
import type { CoverageFormat } from "./coverage/types.js";
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
  coverage: { text: string; format: CoverageFormat; file?: string } | { missingFile: string };
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
}

/** The whole pharn-ci check as one pure function: raw inputs in, Report v1 out. */
export function check(input: CheckInput): Report {
  // Validate before any early return, so a bad pattern is an error even when nothing else is computed.
  const matchers = [...new Set((input.exclude ?? []).map((p) => parseExcludePattern(p)))].map(compileGlob);
  const isExcluded = (path: string) => matchers.some((matches) => matches(path));
  const agentSetup = scanAgentSetup(input.repoFiles);
  const base = { version: input.version, threshold: input.threshold, agentSetup };

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

  const coverage = parseCoverage(
    input.coverage.text,
    input.coverage.format,
    input.repoRoot === undefined ? {} : { repoRoot: input.repoRoot },
  );
  // An empty or unreadable report would otherwise make every change look uncovered-but-untracked
  // and pass as NO_COVERABLE_CHANGES. Say so instead.
  if (coverage.size === 0) {
    return buildReport({
      ...base,
      diffCoverage: null,
      missing: { reason: "coverage-file-empty", coverageFile: input.coverage.file ?? null },
    });
  }
  const diff = parseUnifiedDiff(input.diff.text);
  return buildReport({ ...base, diffCoverage: computeDiffCoverage(diff, coverage, input.threshold, isExcluded) });
}
