import type { CoverageFormat } from "./coverage/types.js";
import type { DiffCoverageFile, DiffCoverageResult } from "./diffCoverage.js";
import type { AgentSetupFile, AgentSetupInventory } from "./setup/scan.js";
import { type AgentSetupSummary, summarizeAgentSetup } from "./setup/summary.js";

/** TypeScript mirror of schema/report.v1.json. The schema is the source of truth. */
export interface Report {
  schemaVersion: "1";
  tool: { name: "pharn-ci"; version: string };
  verdict: Verdict;
  diffCoverage: ReportDiffCoverage | null;
  agentSetup: { files: AgentSetupFile[]; summary?: AgentSetupSummary };
  messages: Message[];
}

export type Verdict = "pass" | "warn" | "fail";

export interface ReportDiffCoverage {
  /** The coverage format the report was read as. Absent when the producer did not say. */
  format?: CoverageFormat;
  percent: number | null;
  threshold: number | null;
  coveredLines: number;
  coverableLines: number;
  files: DiffCoverageFile[];
  /** Sorted repo-relative paths of changed files left out by an exclusion pattern; present only when at least one was. */
  excludedFiles?: string[];
}

export type MessageLevel = "info" | "warn" | "error";

/** Stable message codes. Add new ones here and in the schema description; never rename. */
export type MessageCode =
  | "DIFF_COVERAGE_BELOW_THRESHOLD"
  | "DIFF_COVERAGE_UNGATED"
  | "NO_COVERABLE_CHANGES"
  | "COVERAGE_FILE_MISSING"
  | "COVERAGE_FILE_EMPTY"
  | "COVERAGE_FORMAT_UNSUPPORTED"
  | "DIFF_UNAVAILABLE"
  | "COVERAGE_PATHS_UNMATCHED"
  | "COVERAGE_PATHS_PARTIALLY_UNMATCHED"
  | "CONFIG_CHANGED_IN_DIFF"
  | "COVERAGE_FILE_TRACKED"
  | "DIFF_BINARY_COVERED_FILE"
  | "NO_AGENT_SETUP_FILES";

export interface Message {
  level: MessageLevel;
  code: MessageCode;
  text: string;
}

export interface BuildReportInput {
  version: string;
  /** null when no coverage data was available; see `coverageFile`. */
  diffCoverage: DiffCoverageResult | null;
  /** Threshold that applies even when diff coverage could not be computed. */
  threshold: number | null;
  /** The format the coverage file was read as; carried into `diffCoverage.format` when given. */
  coverageFormat?: CoverageFormat;
  /** Why diff coverage is missing, when it is. */
  missing?:
    | { reason: "coverage-file-missing"; coverageFile: string }
    | { reason: "coverage-file-empty"; coverageFile: string | null }
    | { reason: "coverage-format-unsupported"; coverageFile: string | null }
    | { reason: "diff-unavailable"; detail: string }
    | { reason: "coverage-paths-unmatched"; total: number; example: string; suggestedRoot: string | null };
  /** Count of distinct coverage paths that are not tracked files, when some but not all are; absent or 0 adds no message. */
  untrackedCoveragePaths?: number;
  /** Repo-relative paths the diff edits that configure this check (the config in use, workflows); absent or empty adds no message. */
  changedConfigPaths?: readonly string[];
  /** Repo-relative path of the coverage file when it is a tracked file; absent adds no message. */
  trackedCoverageFile?: string;
  /** Changed files the diff shows as binary that the coverage report knows; absent or empty adds no message. */
  binaryCoveredPaths?: readonly string[];
  agentSetup: AgentSetupInventory;
  /** When true, a repo with no agent setup files is an error instead of info. Off when absent. */
  requireAgentSetup?: boolean;
}

export function buildReport(input: BuildReportInput): Report {
  const messages: Message[] = [];
  const dc = input.diffCoverage;

  if (dc === null) {
    const missing = input.missing ?? { reason: "diff-unavailable", detail: "no diff coverage data" };
    // Diff coverage could not be computed (no coverage file, an empty or unrecognized one, coverage paths that
    // match no tracked file, or no diff). With a
    // threshold the user asked for a gate, and a gate that cannot measure must fail closed, so this is an error
    // (threshold 0 included). Without a threshold pharn-ci only reports, so it stays a warning.
    const level: MessageLevel = input.threshold === null ? "warn" : "error";
    if (missing.reason === "coverage-file-missing") {
      messages.push({
        level,
        code: "COVERAGE_FILE_MISSING",
        text: `Coverage file not found: ${missing.coverageFile}`,
      });
    } else if (missing.reason === "coverage-file-empty") {
      const where = missing.coverageFile === null ? "The coverage report" : `Coverage file ${missing.coverageFile}`;
      messages.push({
        level,
        code: "COVERAGE_FILE_EMPTY",
        text: `${where} contains no coverage records; check its format and that the tests wrote it.`,
      });
    } else if (missing.reason === "coverage-format-unsupported") {
      const where = missing.coverageFile === null ? "The coverage report" : `Coverage file ${missing.coverageFile}`;
      messages.push({
        level,
        code: "COVERAGE_FORMAT_UNSUPPORTED",
        text: `${where} is not in a recognized coverage format; pharn-ci reads lcov and Cobertura XML.`,
      });
    } else if (missing.reason === "coverage-paths-unmatched") {
      messages.push({ level, code: "COVERAGE_PATHS_UNMATCHED", text: unmatchedText(missing) });
    } else {
      messages.push({
        level,
        code: "DIFF_UNAVAILABLE",
        text: `Diff coverage was not computed: ${missing.detail}`,
      });
    }
  } else if (dc.coverableLines === 0) {
    messages.push({
      level: "info",
      code: "NO_COVERABLE_CHANGES",
      text: "No added lines are tracked by the coverage report; nothing to measure.",
    });
  } else if (!dc.meetsThreshold && dc.threshold !== null) {
    messages.push({
      level: "error",
      code: "DIFF_COVERAGE_BELOW_THRESHOLD",
      text: `Diff coverage ${formatNumber(dc.percent ?? 0)}% is below the threshold of ${formatNumber(dc.threshold)}%.`,
    });
  } else if (dc.threshold === null || dc.threshold === 0) {
    // Measured but not gated: say so, so a pass is not read as "met a threshold".
    const why = dc.threshold === null ? "no threshold is set" : "a threshold of 0% accepts any coverage";
    messages.push({
      level: "info",
      code: "DIFF_COVERAGE_UNGATED",
      text: `Diff coverage ${formatNumber(dc.percent ?? 0)}% is not gated: ${why}.`,
    });
  }

  const untracked = input.untrackedCoveragePaths ?? 0;
  if (untracked > 0) {
    const subject =
      untracked === 1
        ? "1 file path in the coverage report is not a tracked file in the repository; its coverage is not used."
        : `${untracked} file paths in the coverage report are not tracked files in the repository; their coverage is not used.`;
    messages.push({ level: "info", code: "COVERAGE_PATHS_PARTIALLY_UNMATCHED", text: subject });
  }

  if (input.changedConfigPaths !== undefined && input.changedConfigPaths.length > 0) {
    messages.push({
      level: "warn",
      code: "CONFIG_CHANGED_IN_DIFF",
      text: `This change edits files that configure this check: ${pathList(input.changedConfigPaths)}. Review them before trusting the verdict.`,
    });
  }
  if (input.trackedCoverageFile !== undefined) {
    messages.push({
      level: "warn",
      code: "COVERAGE_FILE_TRACKED",
      text: `The coverage file ${codeSpan(input.trackedCoverageFile)} is tracked in the repository, so the change under review can supply its own coverage numbers.`,
    });
  }
  if (input.binaryCoveredPaths !== undefined && input.binaryCoveredPaths.length > 0) {
    messages.push({
      level: "warn",
      code: "DIFF_BINARY_COVERED_FILE",
      text: `The diff shows ${pathList(input.binaryCoveredPaths)} as binary, so their added lines were not measured; check .gitattributes for -diff or binary on source files.`,
    });
  }

  if (input.agentSetup.files.length === 0) {
    const required = input.requireAgentSetup === true;
    const found = "No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found";
    messages.push({
      level: required ? "error" : "info",
      code: "NO_AGENT_SETUP_FILES",
      text: required ? `${found}, and agent setup is required by config.` : `${found}.`,
    });
  }

  return {
    schemaVersion: "1",
    tool: { name: "pharn-ci", version: input.version },
    verdict: verdictOf(messages),
    diffCoverage:
      dc === null
        ? null
        : {
            ...(input.coverageFormat === undefined ? {} : { format: input.coverageFormat }),
            percent: dc.percent,
            threshold: dc.threshold,
            coveredLines: dc.coveredLines,
            coverableLines: dc.coverableLines,
            files: dc.files,
            ...(dc.excludedFiles !== undefined && dc.excludedFiles.length > 0
              ? { excludedFiles: dc.excludedFiles }
              : {}),
          },
    agentSetup: { files: input.agentSetup.files, summary: summarizeAgentSetup(input.agentSetup.files) },
    messages,
  };
}

function unmatchedText(missing: { total: number; example: string; suggestedRoot: string | null }): string {
  const head =
    missing.total === 1
      ? "None of the 1 file path in the coverage report is a tracked file in the repository"
      : `None of the ${missing.total} file paths in the coverage report are tracked files in the repository`;
  const hint =
    missing.suggestedRoot === null
      ? "Write coverage paths relative to the repository root or as absolute paths under the checkout, or set coverage-root to the directory relative paths start from."
      : `The paths look relative to ${codeSpan(missing.suggestedRoot)}: set coverage-root: ${codeSpan(missing.suggestedRoot)} (coverage.root in .pharn/ci.yml, --coverage-root in the CLI).`;
  return `${head} (for example ${codeSpan(missing.example)}), so diff coverage was not measured. ${hint}`;
}

/** Most paths a message names; the rest are counted. */
const MAX_NAMED_PATHS = 5;

/** The first few paths as code spans joined with `, `, then ` and N more` when there are more. */
function pathList(paths: readonly string[]): string {
  const named = paths.slice(0, MAX_NAMED_PATHS).map(codeSpan).join(", ");
  const more = paths.length - MAX_NAMED_PATHS;
  return more > 0 ? `${named} and ${more} more` : named;
}

/**
 * Quote untrusted text (a coverage path, or a directory name from the tracked files) as one code span on
 * one line: control characters and line breaks become U+FFFD and backticks become `'`, so the text cannot
 * end its span or start a new line.
 */
function codeSpan(text: string): string {
  const safe = text.replace(CONTROL_CHARS, "\uFFFD").replace(/`/g, "'");
  return `\`${safe}\``;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export function verdictOf(messages: readonly Message[]): Verdict {
  if (messages.some((m) => m.level === "error")) return "fail";
  if (messages.some((m) => m.level === "warn")) return "warn";
  return "pass";
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}
