import type { CoverageFormat } from "./coverage/types.js";
import { coverageNotDiscoveredText } from "./coverageDiscovery.js";
import type { DiffCoverageFile, DiffCoverageResult } from "./diffCoverage.js";
import type { AgentSetupFile, AgentSetupInventory } from "./setup/scan.js";
import { AGENT_TOOLS, type AgentSetupSummary, type AgentTool, summarizeAgentSetup } from "./setup/summary.js";
import type { ResolvedTestIntegrityMode } from "./testIntegrityMode.js";

/**
 * TypeScript mirror of schema/report.v2.json, which is Report v1 (schema/report.v1.json) plus optional top-level
 * objects. The schemas are the source of truth.
 */
export interface Report {
  schemaVersion: 2;
  tool: { name: "pharn-ci"; version: string };
  verdict: Verdict;
  diffCoverage: ReportDiffCoverage | null;
  agentSetup: {
    files: AgentSetupFile[];
    summary?: AgentSetupSummary;
    /** Sorted expected tools no setup file configures; present only when a tool was expected. */
    missing?: AgentTool[];
  };
  messages: Message[];
  /** Test-integrity findings; always present. */
  testIntegrity: ReportTestIntegrity;
  /** Run metadata; present only when the caller (the Action) gave it. */
  meta?: ReportMeta;
}

export type TestIntegrityMode = "block" | "warn" | "off";

export interface TestIntegritySignal {
  /** TI01–TI16. */
  id: string;
  severity: "block" | "warn" | "info";
  path: string;
  /** 1-based line in the head file, or null. */
  line: number | null;
  detail: string;
  base?: string;
  head?: string;
}

export interface ReportTestIntegrity {
  /** The effective mode after precedence. */
  mode: TestIntegrityMode;
  /** Where the effective mode came from. */
  source: "default" | "input" | "config" | "policy";
  verdict: Verdict;
  accepted?: { label: string; by: string | null } | null;
  signals: TestIntegritySignal[];
  /** Which detectors ran. */
  languages: ("ts" | "js" | "py" | "go")[];
}

export type ReportMetaEvent = "pull_request" | "merge_group" | "push" | "workflow_run" | "workflow_dispatch" | "other";

export interface ReportMeta {
  event: ReportMetaEvent;
  /** owner/name */
  repository: string;
  repositoryId?: number;
  prNumber?: number | null;
  /** 40 or 64 lowercase hex characters. */
  headSha: string;
  baseSha?: string | null;
  mergeBase?: string | null;
  /** workflow/job */
  scope: string;
  runId: number;
  runAttempt: number;
  actor?: string;
  upload: { status: "ok" | "skipped" | "failed" | "too_large"; runUrl?: string };
}

/** The test-integrity block of a run in which no detector ran: the default mode, nothing found. */
export function emptyTestIntegrity(): ReportTestIntegrity {
  return { mode: "warn", source: "default", verdict: "pass", signals: [], languages: [] };
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
  | "COVERAGE_LINES_SKIPPED"
  | "CONFIG_CHANGED_IN_DIFF"
  | "COVERAGE_FILE_TRACKED"
  | "DIFF_BINARY_COVERED_FILE"
  | "TEST_FILES_DELETED"
  | "NO_AGENT_SETUP_FILES"
  | "AGENT_SETUP_FILE_EMPTY"
  | "AGENT_SETUP_EXPECTED_MISSING"
  | "TEST_INTEGRITY_MODE_IGNORED"
  | "TEST_INTEGRITY_OFF"
  | "TEST_INTEGRITY_TI01"
  | "TEST_INTEGRITY_TI03"
  | "TEST_INTEGRITY_TI04"
  | "TEST_INTEGRITY_TI10"
  | "TEST_INTEGRITY_TI11"
  | "TEST_INTEGRITY_TI13"
  | "TEST_INTEGRITY_TI14";

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
    | { reason: "coverage-not-discovered" }
    | { reason: "coverage-file-empty"; coverageFile: string | null }
    | { reason: "coverage-format-unsupported"; coverageFile: string | null }
    | { reason: "diff-unavailable"; detail: string }
    | { reason: "coverage-paths-unmatched"; total: number; example: string; suggestedRoot: string | null };
  /** Count of distinct coverage paths that are not tracked files, when some but not all are; absent or 0 adds no message. */
  untrackedCoveragePaths?: number;
  /** Count of malformed coverage records the parsers skipped; absent or 0 adds no message. Only set when diff coverage was computed. */
  skippedCoverageLines?: number;
  /** Repo-relative paths the diff edits that configure this check (the config in use, workflows); absent or empty adds no message. */
  changedConfigPaths?: readonly string[];
  /** Repo-relative path of the coverage file when it is a tracked file; absent adds no message. */
  trackedCoverageFile?: string;
  /** Changed files the diff shows as binary that the coverage report knows; absent or empty adds no message. */
  binaryCoveredPaths?: readonly string[];
  /** Repo-relative test files the diff deletes or renames to a non-test name; absent or empty adds no message. */
  deletedTestFiles?: readonly string[];
  agentSetup: AgentSetupInventory;
  /** Sorted paths of inventoried agent setup files whose size in HEAD is 0; absent or empty adds no message. */
  emptyAgentSetupFiles?: readonly string[];
  /** When true, a repo with no agent setup files is an error instead of info. Off when absent. */
  requireAgentSetup?: boolean;
  /**
   * Agent tools the report names when no setup file configures them. Only names from the fixed tool list
   * reach the report; absent or empty adds no field and no message.
   */
  expectedAgentTools?: readonly AgentTool[];
  /** Run metadata copied into the report as given; absent adds no field. */
  meta?: ReportMeta;
  /** The effective test-integrity mode (see `resolveTestIntegrityMode`). Absent means the default `warn`. */
  testIntegrity?: ResolvedTestIntegrityMode;
  /**
   * The test-integrity signals the detectors found, each with its effective severity (sorted by the caller). They fill
   * `testIntegrity.signals` and `testIntegrity.verdict`; each signal id also adds one `TEST_INTEGRITY_<id>` message
   * (TI01, TI03, TI04, TI10, TI11, TI13, TI14).
   * Absent or empty adds nothing.
   */
  testIntegritySignals?: readonly TestIntegritySignal[];
}

/** The one message each test-integrity signal id adds to a report that carries findings of that id. */
const SIGNAL_MESSAGES: ReadonlyArray<{
  id: string;
  code: MessageCode;
  text: (top: "block" | "warn" | "info", paths: string) => string;
}> = [
  {
    id: "TI01",
    code: "TEST_INTEGRITY_TI01",
    text: (top, paths) =>
      top === "info"
        ? `This change deletes test files together with the code they cover or replaces them: ${paths}.`
        : `This change deletes or renames away test files that defined tests, with nothing in the change that accounts for them: ${paths}. Check that those tests were meant to go.`,
  },
  {
    id: "TI03",
    code: "TEST_INTEGRITY_TI03",
    text: (_top, paths) =>
      `This change skips tests or marks them as expected to fail: ${paths}. Check that each skip was meant.`,
  },
  {
    id: "TI04",
    code: "TEST_INTEGRITY_TI04",
    text: (_top, paths) =>
      `This change adds \`.only\`, \`fit\` or \`fdescribe\`, which runs only the marked tests: ${paths}. Remove the markers before merging.`,
  },
  {
    id: "TI10",
    code: "TEST_INTEGRITY_TI10",
    text: (_top, paths) =>
      `This change weakens a test script in package.json, so the test run can pass without the tests passing: ${paths}. Check that the change was meant.`,
  },
  {
    id: "TI11",
    code: "TEST_INTEGRITY_TI11",
    text: (_top, paths) =>
      `This change edits a workflow so that CI may run fewer tests or ignore their failures: ${paths}. Check that the removed step or trigger, the reduced matrix or the added condition was meant.`,
  },
  {
    id: "TI13",
    code: "TEST_INTEGRITY_TI13",
    text: (_top, paths) =>
      `This change adds comments that leave code out of coverage: ${paths}. Check that each was meant.`,
  },
  {
    id: "TI14",
    code: "TEST_INTEGRITY_TI14",
    text: (_top, paths) =>
      `This change lowers the coverage threshold or adds a coverage exclusion in the check config: ${paths}. Check that the looser setting was meant before trusting the result.`,
  },
];

export function buildReport(input: BuildReportInput): Report {
  const messages: Message[] = [];
  const dc = input.diffCoverage;
  const summary = summarizeAgentSetup(input.agentSetup.files);
  const expected = input.expectedAgentTools ?? [];
  // Filtering the fixed list keeps only its names, once each, whatever a direct caller passes. Named apart from
  // `input.missing` (why diff coverage is missing), which the branch below reads.
  const missingTools = AGENT_TOOLS.filter((tool) => expected.includes(tool) && !summary.tools.includes(tool)).sort();

  if (dc === null) {
    const missing = input.missing ?? { reason: "diff-unavailable", detail: "no diff coverage data" };
    // Diff coverage could not be computed (no coverage file, none discovered, an empty or unrecognized one, coverage paths that
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
    } else if (missing.reason === "coverage-not-discovered") {
      // The existing code: no coverage file, here because none of the auto-discovery candidates exists.
      messages.push({ level, code: "COVERAGE_FILE_MISSING", text: coverageNotDiscoveredText() });
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

  const skippedLines = input.skippedCoverageLines ?? 0;
  if (skippedLines > 0) {
    const subject =
      skippedLines === 1
        ? "1 malformed coverage record was skipped (an lcov DA record or Cobertura line with an invalid line number or hit count, or a DA record outside an SF record), so diff coverage leaves it out; check that the coverage reporter finished writing the file."
        : `${skippedLines} malformed coverage records were skipped (lcov DA records or Cobertura lines with an invalid line number or hit count, or DA records outside an SF record), so diff coverage leaves them out; check that the coverage reporter finished writing the file.`;
    messages.push({ level: "info", code: "COVERAGE_LINES_SKIPPED", text: subject });
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
  if (input.deletedTestFiles !== undefined && input.deletedTestFiles.length > 0) {
    messages.push({
      level: "info",
      code: "TEST_FILES_DELETED",
      text: `This change deletes or renames away test files: ${pathList(input.deletedTestFiles)}. Check that the tests they held were meant to go before trusting the result.`,
    });
  }

  const testIntegrity = input.testIntegrity;
  if (testIntegrity?.ignoredConfig !== undefined) {
    messages.push({
      level: "warn",
      code: "TEST_INTEGRITY_MODE_IGNORED",
      text: `.pharn/ci.yml sets test_integrity.mode to ${testIntegrity.ignoredConfig}, which is looser than ${testIntegrity.mode}, so ${testIntegrity.mode} applies: the config can only make the check stricter.`,
    });
  }
  if (testIntegrity?.mode === "off") {
    messages.push({
      level: "info",
      code: "TEST_INTEGRITY_OFF",
      text: "Test integrity is off for this run, so no test-integrity signal is checked.",
    });
  }

  const signals = [...(input.testIntegritySignals ?? [])];
  for (const { id, code, text } of SIGNAL_MESSAGES) {
    const own = signals.filter((signal) => signal.id === id);
    if (own.length === 0) continue;
    // One message per signal id; its level is the highest severity among the findings, and it names those files.
    const top = own.some((s) => s.severity === "block")
      ? "block"
      : own.some((s) => s.severity === "warn")
        ? "warn"
        : "info";
    const named = [...new Set(own.filter((s) => s.severity === top).map((s) => s.path))];
    messages.push({
      level: top === "block" ? "error" : top === "warn" ? "warn" : "info",
      code,
      text: text(top, pathList(named)),
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

  if (missingTools.length > 0) {
    messages.push({
      level: input.requireAgentSetup === true ? "error" : "warn",
      code: "AGENT_SETUP_EXPECTED_MISSING",
      text: `No agent setup file configures the expected tool${missingTools.length === 1 ? "" : "s"}: ${missingTools.join(", ")}.`,
    });
  }

  const empty = input.emptyAgentSetupFiles ?? [];
  const firstEmpty = empty[0];
  if (firstEmpty !== undefined) {
    const text =
      empty.length === 1
        ? `1 agent setup file is empty: ${codeSpan(firstEmpty)}.`
        : `${empty.length} agent setup files are empty, for example ${codeSpan(firstEmpty)}.`;
    messages.push({ level: "warn", code: "AGENT_SETUP_FILE_EMPTY", text });
  }

  return {
    schemaVersion: 2,
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
    agentSetup: {
      files: input.agentSetup.files,
      summary,
      ...(expected.length > 0 ? { missing: missingTools } : {}),
    },
    messages,
    testIntegrity: {
      ...emptyTestIntegrity(),
      ...(testIntegrity === undefined ? {} : { mode: testIntegrity.mode, source: testIntegrity.source }),
      verdict: signals.some((s) => s.severity === "block")
        ? "fail"
        : signals.some((s) => s.severity === "warn")
          ? "warn"
          : "pass",
      signals,
    },
    ...(input.meta === undefined ? {} : { meta: input.meta }),
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
