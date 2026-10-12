import { parseCoverage } from "./coverage/index.js";
import type { CoverageFormat } from "./coverage/types.js";
import { parseUnifiedDiff } from "./diff/unified.js";
import { computeDiffCoverage } from "./diffCoverage.js";
import { buildReport, type Report } from "./report.js";
import { scanAgentSetup } from "./setup/scan.js";

export interface CheckInput {
  version: string;
  /** Coverage report contents, or the path that was looked for when it is missing. */
  coverage: { text: string; format: CoverageFormat } | { missingFile: string };
  /** Unified diff text, or why no diff is available. */
  diff: { text: string } | { unavailable: string };
  /** Absolute repo root, used to relativize absolute coverage paths. */
  repoRoot?: string;
  threshold: number | null;
  /** Repo-relative tracked paths (e.g. `git ls-files`). */
  repoFiles: readonly string[];
}

/** The whole pharn-ci check as one pure function: raw inputs in, Report v1 out. */
export function check(input: CheckInput): Report {
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
  const diff = parseUnifiedDiff(input.diff.text);
  return buildReport({ ...base, diffCoverage: computeDiffCoverage(diff, coverage, input.threshold) });
}
