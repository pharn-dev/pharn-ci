import type { CoverageFormat } from "./coverage/types.js";
import { coverageNotDiscoveredText } from "./coverageDiscovery.js";
import { MAX_KEPT_LINES } from "./diff/unified.js";
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
  /** The org policy's findings; present only when a policy was asked for and is in force or unavailable. */
  policy?: ReportPolicy;
  /** Run metadata; present only when the caller (the Action) gave it. */
  meta?: ReportMeta;
}

/** One finding of an org-policy rule, as the report carries it. */
export interface ReportPolicyViolation {
  id: string;
  severity: "block" | "warn" | "info" | "pending";
  path: string | null;
  line: number | null;
  detail: string;
}

/** The `policy` object of the report: where the policy came from and what the rules found. */
export interface ReportPolicy {
  source: "app" | "input" | "config" | "none";
  version: number | null;
  fetchedAt?: string;
  violations: ReportPolicyViolation[];
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
  /**
   * The accept label the Action was given, written only when it is not the default `pharn/accepted`. Never set by
   * `check()` or the CLI.
   */
  acceptLabel?: string;
  signals: TestIntegritySignal[];
  /** Which detectors ran. */
  languages: ("ts" | "js" | "py" | "go")[];
  /** The tests the touched test files add, remove, modify or rename; present only when at least one test changed. */
  changes?: ReportTestChanges;
}

/** One test in the tests-changed summary. `name` is the full name, cut to 120 characters. */
export interface ReportTestChange {
  path: string;
  name: string;
  line: number;
}

/** One test file's row of the tests-changed summary. */
export interface ReportTestChangesFile {
  path: string;
  language: "ts" | "js" | "py";
  added: number;
  removed: number;
  modified: number;
  renamed: number;
}

/** The tests-changed summary: counts per kind and per file, and the tests by name (at most 200 across the lists). */
export interface ReportTestChanges {
  totals: { added: number; removed: number; modified: number; renamed: number };
  files: ReportTestChangesFile[];
  added: ReportTestChange[];
  removed: ReportTestChange[];
  modified: ReportTestChange[];
  renamed: ReportTestChange[];
  /** How many tests the 200-entry cap left out of the lists; absent when none were. */
  truncated?: number;
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
  /** The pull request's author, when the Action read a valid login and type; `null` when it could not. */
  prAuthor?: { login: string; type: "User" | "Bot" | "Organization" } | null;
  /** The pull request's label names: at most 100, each cut to 50 code points. */
  prLabels?: string[];
  /** The agent co-authors of its commits, as `<hint or login> <email>`; at most 20. A person is never recorded. */
  coAuthors?: string[];
  /** The known agent the evidence points to, or `null`. */
  agentHint?: string | null;
  /** `true` when the pull request counts as an agent PR, including when the evidence could not be read in full. */
  isAgentPr?: boolean;
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
  | "TEST_INTEGRITY_TI02"
  | "TEST_INTEGRITY_TI03"
  | "TEST_INTEGRITY_TI04"
  | "TEST_INTEGRITY_TI05"
  | "TEST_INTEGRITY_TI06"
  | "TEST_INTEGRITY_TI07"
  | "TEST_INTEGRITY_TI08"
  | "TEST_INTEGRITY_TI09"
  | "TEST_INTEGRITY_TI10"
  | "TEST_INTEGRITY_TI11"
  | "TEST_INTEGRITY_TI12"
  | "TEST_INTEGRITY_TI13"
  | "TEST_INTEGRITY_TI14"
  | "TEST_INTEGRITY_TI15"
  | "TEST_INTEGRITY_TI16"
  | "TEST_INTEGRITY_INDEX_UNAVAILABLE"
  | "TEST_INTEGRITY_TEXT_TRUNCATED"
  | "TEST_INTEGRITY_ACCEPTED"
  | "TEST_INTEGRITY_ACCEPT_IGNORED"
  | "AGENT_CONFIG_SECRET_S01"
  | "AGENT_CONFIG_SECRET_S02"
  | "AGENT_CONFIG_SECRET_S03"
  | "AGENT_CONFIG_SECRET_S04"
  | "AGENT_CONFIG_SECRET_S05"
  | "AGENT_CONFIG_SECRET_S06"
  | "AGENT_CONFIG_SECRET_S07"
  | "AGENT_CONFIG_SECRET_S08"
  | "AGENT_CONFIG_SECRET_S09"
  | "AGENT_CONFIG_SECRET_S10"
  | "AGENT_CONFIG_SECRET_S11"
  | "AGENT_CONFIG_SECRET_UNSCANNED"
  | "POLICY_UNAVAILABLE"
  | "POLICY_OVERRIDE_IGNORED"
  | "UPLOAD_TOO_LARGE"
  | "POLICY_P08"
  | "POLICY_P09"
  | "POLICY_P11"
  | "AGENT_PR_DETECTION_INCOMPLETE";

export interface Message {
  level: MessageLevel;
  code: MessageCode;
  text: string;
}

/**
 * The findings of one file and signal id that a cap left out of `testIntegrity.signals`: the 20-per-file cap of the
 * base-and-head signals, or the 10-per-change cap of TI15 (counted per source path).
 */
export interface OmittedSignals {
  id: string;
  path: string;
  count: number;
}

/** Test files that TI02 and TI05 could not compare, or why they did not run at all. */
export type TestIndexUnavailable = { files: readonly { path: string; reason: string }[] } | { notRun: string };

/** Touched test-config files that TI09 could not read, or why it did not run at all. */
export type TestConfigUnavailable = { files: readonly { path: string; reason: string }[] } | { notRun: string };

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
   * (TI01, TI03, TI04, TI08, TI10, TI11, TI13, TI14, TI15, TI16).
   * Absent or empty adds nothing.
   */
  testIntegritySignals?: readonly TestIntegritySignal[];
  /**
   * The files whose kept diff text was cut at the bound where a signal reads the added lines (see
   * `textCutSignalFiles`), so a finding past the cut is not seen. Adds one `TEST_INTEGRITY_TEXT_TRUNCATED` warn
   * message unless the mode is off. Absent or empty adds nothing.
   */
  textTruncatedFiles?: readonly string[];
  /** The sorted languages of the test files the base-and-head signals indexed; fills `testIntegrity.languages`. */
  testIntegrityLanguages?: readonly ("ts" | "js" | "py" | "go")[];
  /** Findings the per-file cap left out of `testIntegrity.signals`; the TI02, TI05, TI06, TI09 and TI12 messages say how many. */
  omittedSignals?: readonly OmittedSignals[];
  /** Touched test files TI02 and TI05 could not compare, or why they did not run; adds one warn message. */
  testIndexUnavailable?: TestIndexUnavailable;
  /** The tests-changed summary (see `summarizeTestChanges`); fills `testIntegrity.changes`. Absent adds nothing. */
  testChanges?: ReportTestChanges;
  /**
   * Touched test-config files TI09 could not read, or why it did not run. Adds one TI09 sentence to the one
   * `TEST_INTEGRITY_INDEX_UNAVAILABLE` message, after the TI02 and TI05 sentence when there is one.
   */
  testConfigUnavailable?: TestConfigUnavailable;
  /**
   * The messages of the agent config secret check (see `agentConfigSecretMessages`), appended after the agent setup
   * messages as given. They name a shape id, paths and line numbers, never a value. Absent or empty adds nothing.
   */
  agentConfigSecretMessages?: readonly Message[];
  /**
   * The messages of the org policy (the unavailable message, the per-rule messages and the ignored-settings message,
   * in that order), appended after the agent config secret messages as given, so they follow every other
   * message. Absent or empty adds nothing.
   */
  policyMessages?: readonly Message[];
  /**
   * The levels the org policy's agent setup rule sets: `noFiles` for the no-agent-setup-files message (which then also says the org
   * policy requires setup), `expectedMissing` for the expected-tools message. Absent keeps today's levels and texts.
   */
  agentSetupLevels?: { noFiles?: MessageLevel; expectedMissing?: MessageLevel };
  /** The org policy object, copied into the report as given; absent adds no key. */
  policy?: ReportPolicy;
}

/**
 * The one message each test-integrity signal id adds to a report that carries findings of that id. `paths` names the
 * top-severity files, or, for an id with `allPaths`, every file of the id, so the text does not depend on severity.
 * `notListed` is empty, or the sentence that says how many findings the cap left out.
 */
const SIGNAL_MESSAGES: ReadonlyArray<{
  id: string;
  code: MessageCode;
  allPaths?: true;
  text: (top: "block" | "warn" | "info", paths: string, notListed: string) => string;
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
    id: "TI02",
    code: "TEST_INTEGRITY_TI02",
    allPaths: true,
    text: (_top, paths, notListed) =>
      `This change removes tests from test files that stay, with no test of the same name or a similar body in the touched test files to take their place: ${paths}. Check that each removal was meant.${notListed}`,
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
    id: "TI05",
    code: "TEST_INTEGRITY_TI05",
    allPaths: true,
    text: (_top, paths, notListed) =>
      `This change leaves tests with fewer assertions than they had, or none: ${paths}. Check that each test still checks what it did.${notListed}`,
  },
  {
    id: "TI06",
    code: "TEST_INTEGRITY_TI06",
    allPaths: true,
    text: (_top, paths, notListed) =>
      `This change weakens tests that stay: a stronger matcher became a weaker one, an assertion guard was lowered or removed, an assertion that compares a literal with itself was added, or an assertion moved into a try block or after an early return: ${paths}. Check that each test still checks what it did.${notListed}`,
  },
  {
    id: "TI07",
    code: "TEST_INTEGRITY_TI07",
    allPaths: true,
    text: (_top, paths, notListed) =>
      `This change edits only the expected values of tests while it also edits source files, so the tests may have been made to agree with the code: ${paths}. Check that each new expected value is right.${notListed}`,
  },
  {
    id: "TI08",
    code: "TEST_INTEGRITY_TI08",
    text: (_top, paths) =>
      `This change regenerates or updates snapshots in bulk: ${paths}. Check that each new snapshot was reviewed.`,
  },
  {
    id: "TI09",
    code: "TEST_INTEGRITY_TI09",
    allPaths: true,
    text: (_top, paths, notListed) =>
      `This change loosens test-runner settings so that fewer tests run, a weaker run passes or the coverage gate drops: ${paths}. Check that each looser setting was meant.${notListed}`,
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
    id: "TI12",
    code: "TEST_INTEGRITY_TI12",
    allPaths: true,
    text: (_top, paths, notListed) =>
      `This change mocks a module it also edits, so the tests may not run the code under review: ${paths}. Check that each mock was meant.${notListed}`,
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
  {
    id: "TI15",
    code: "TEST_INTEGRITY_TI15",
    allPaths: true,
    text: (_top, paths, notListed) =>
      `This change adds conditions in source that compare against values its tests add, so the code may special-case the tests: ${paths}. Check that each is real logic.${notListed}`,
  },
  {
    id: "TI16",
    code: "TEST_INTEGRITY_TI16",
    text: (_top, paths) =>
      `This change adds comments that switch off a linter or type checker in test files: ${paths}.`,
  },
];

/**
 * The one `TEST_INTEGRITY_<id>` message per signal id found, in the fixed id order. A message's level is the highest
 * severity among the findings of its id (error for block, warn, else info), and its text names those files. One rule,
 * used by `buildReport` and again when a downgrade changes severities.
 */
export function testIntegritySignalMessages(
  signals: readonly TestIntegritySignal[],
  options: { omitted?: readonly OmittedSignals[]; previous?: readonly Message[] } = {},
): Message[] {
  const messages: Message[] = [];
  for (const { id, code, allPaths, text } of SIGNAL_MESSAGES) {
    const own = signals.filter((signal) => signal.id === id);
    if (own.length === 0) continue;
    const top = own.some((s) => s.severity === "block")
      ? "block"
      : own.some((s) => s.severity === "warn")
        ? "warn"
        : "info";
    const level = top === "block" ? "error" : top === "warn" ? "warn" : "info";
    // An id whose text is kept (TI02, TI05, TI06, TI07, TI09, TI12, TI15) keeps the text a previous message had, with the "not listed" counts the
    // findings no longer carry; only the level follows the severities.
    const previous = allPaths === true ? options.previous?.find((message) => message.code === code) : undefined;
    if (previous !== undefined) {
      messages.push({ level, code, text: previous.text });
      continue;
    }
    const named = [...new Set(own.filter((s) => allPaths === true || s.severity === top).map((s) => s.path))];
    messages.push({ level, code, text: text(top, pathList(named), notListedText(id, options.omitted ?? [])) });
  }
  return messages;
}

/** The sentence that names how many findings of an id the cap left out, per file; empty when none were. */
function notListedText(id: string, omitted: readonly OmittedSignals[]): string {
  const own = omitted.filter((entry) => entry.id === id && entry.count > 0);
  if (own.length === 0) return "";
  const named = own
    .slice(0, MAX_NAMED_PATHS)
    .map((entry) => `${entry.count} more in ${codeSpan(entry.path)}`)
    .join(", ");
  const more = own.length - MAX_NAMED_PATHS;
  return ` Not listed: ${named}${more > 0 ? ` and ${more} more files` : ""}.`;
}

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
    // With an org policy the message still names the mode the input and the config gave: the policy's own effect is
    // told by the policy messages.
    const against = testIntegrity.baseMode ?? testIntegrity.mode;
    messages.push({
      level: "warn",
      code: "TEST_INTEGRITY_MODE_IGNORED",
      text: `.pharn/ci.yml sets test_integrity.mode to ${testIntegrity.ignoredConfig}, which is looser than ${against}, so ${against} applies: the config can only make the check stricter.`,
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
  messages.push(...testIntegritySignalMessages(signals, { omitted: input.omittedSignals ?? [] }));
  if (testIntegrity?.mode !== "off") {
    const text = indexUnavailableText(input.testIndexUnavailable, input.testConfigUnavailable);
    if (text !== null) messages.push({ level: "warn", code: "TEST_INTEGRITY_INDEX_UNAVAILABLE", text });
  }
  const cut = input.textTruncatedFiles ?? [];
  if (cut.length > 0 && testIntegrity?.mode !== "off") {
    messages.push({
      level: "warn",
      code: "TEST_INTEGRITY_TEXT_TRUNCATED",
      text: `This change is too large to check in full in ${pathList(cut)}: test integrity reads the first ${MAX_KEPT_LINES} changed lines of a file, so a weakened test past them is not seen.`,
    });
  }

  if (input.agentSetup.files.length === 0) {
    const required = input.requireAgentSetup === true;
    const found = "No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found";
    const policyLevel = input.agentSetupLevels?.noFiles;
    if (policyLevel !== undefined) {
      messages.push({
        level: policyLevel,
        code: "NO_AGENT_SETUP_FILES",
        text: `${found}, and agent setup is required by the org policy.`,
      });
    } else {
      messages.push({
        level: required ? "error" : "info",
        code: "NO_AGENT_SETUP_FILES",
        text: required ? `${found}, and agent setup is required by config.` : `${found}.`,
      });
    }
  }

  if (missingTools.length > 0) {
    messages.push({
      level: input.agentSetupLevels?.expectedMissing ?? (input.requireAgentSetup === true ? "error" : "warn"),
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

  messages.push(...(input.agentConfigSecretMessages ?? []));
  messages.push(...(input.policyMessages ?? []));

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
      languages: [...(input.testIntegrityLanguages ?? [])],
      ...(input.testChanges === undefined ? {} : { changes: input.testChanges }),
    },
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    ...(input.meta === undefined ? {} : { meta: input.meta }),
  };
}

/** The most characters of a sources reason a message quotes. */
const MAX_REASON_CHARS = 200;

/** Text from outside on one line: control characters and runs of whitespace become one space; cut, not inside a pair. */
export function oneLine(text: string): string {
  const line = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (line.length <= MAX_REASON_CHARS) return line;
  const end = isHighSurrogate(line.charCodeAt(MAX_REASON_CHARS - 1)) ? MAX_REASON_CHARS - 1 : MAX_REASON_CHARS;
  return line.slice(0, end);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The text of the one `TEST_INTEGRITY_INDEX_UNAVAILABLE` message: the TI02 and TI05 sentence, then the TI09 sentence, joined
 * by one space, each only when it has something to say. The TI02 and TI05 sentence names the touched test files that
 * could not be compared with a code for each (at most 5, then a count), or says they did not run, with the sources
 * reason as one code span. The TI09 sentence does the same for the touched test-config files. Neither a Python run's
 * detail nor any file content is in it. Null when there is nothing to say.
 */
function indexUnavailableText(
  unavailable: TestIndexUnavailable | undefined,
  configUnavailable: TestConfigUnavailable | undefined,
): string | null {
  const parts: string[] = [];
  if (unavailable !== undefined) {
    if ("notRun" in unavailable) {
      parts.push(
        `TI02 and TI05 did not run: the text of the touched test files could not be read (${codeSpan(oneLine(unavailable.notRun))}), so removed tests and emptied assertions are not checked.`,
      );
    } else if (unavailable.files.length > 0) {
      parts.push(
        `TI02 and TI05 could not compare these touched test files, so they are not checked for removed tests or emptied assertions: ${namedFiles(unavailable.files)}.`,
      );
    }
  }
  if (configUnavailable !== undefined) {
    if ("notRun" in configUnavailable) {
      parts.push(
        `TI09 did not run: the text of the touched test-config files could not be read (${codeSpan(oneLine(configUnavailable.notRun))}), so loosened test settings are not checked.`,
      );
    } else if (configUnavailable.files.length > 0) {
      parts.push(
        `TI09 could not read these touched test-config files, so they are not checked for loosened settings: ${namedFiles(configUnavailable.files)}.`,
      );
    }
  }
  return parts.length === 0 ? null : parts.join(" ");
}

/** The first few files as `path (reason)` code spans joined with `, `, then ` and N more` when there are more. */
function namedFiles(files: readonly { path: string; reason: string }[]): string {
  const named = files
    .slice(0, MAX_NAMED_PATHS)
    .map((file) => `${codeSpan(file.path)} (${codeSpan(file.reason)})`)
    .join(", ");
  const more = files.length - MAX_NAMED_PATHS;
  return `${named}${more > 0 ? ` and ${more} more` : ""}`;
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
export function codeSpan(text: string): string {
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
