import { parseAgentToolNames, parseCoverageRoot, parseExcludePattern } from "./config.js";
import { chooseCoverageFormat, type DetectedCoverageFormat } from "./coverage/detect.js";
import { parseCoverageCounted } from "./coverage/index.js";
import { matchCoveragePaths } from "./coverage/match.js";
import { mergeCoverageMaps } from "./coverage/merge.js";
import type { CoverageFormat, CoverageFormatSelection, CoverageMap } from "./coverage/types.js";
import type { CoverageDiscoveryNotFound } from "./coverageDiscovery.js";
import { type DiffFile, parseUnifiedDiff } from "./diff/unified.js";
import { computeDiffCoverage } from "./diffCoverage.js";
import { binaryCoveredPaths, changedConfigPaths, configRepoPath, trackedCoverageFile } from "./gateInputs.js";
import { compileGlob } from "./glob.js";
import { policyOverrideIgnoredMessage, policyUnavailableMessage } from "./policy/messages.js";
import type { IgnoredSetting, ResolvedPolicy, SignalOverrides } from "./policy/resolved.js";
import { evaluatePolicyRules } from "./policy/rules/evaluate.js";
import { policyRuleMessages } from "./policy/rules/messages.js";
import { NO_SETUP_DETAIL } from "./policy/rules/p01.js";
import { levelOf, strongest } from "./policy/rules/severity.js";
import {
  buildReport,
  type Message,
  type OmittedSignals,
  type Report,
  type ReportMeta,
  type ReportPolicy,
  type ReportTestChanges,
  type TestConfigUnavailable,
  type TestIndexUnavailable,
  type TestIntegritySignal,
} from "./report.js";
import { agentConfigSecretMessages } from "./secrets/messages.js";
import { type AgentConfigSources, agentConfigSecretPaths } from "./secrets/scan.js";
import { scanAgentSetup } from "./setup/scan.js";
import { summarizeAgentSetup } from "./setup/summary.js";
import { capFindings } from "./signals/findingCap.js";
import { applySignalOverrides } from "./signals/overrides.js";
import { keepSignalFileText, textCutSignalFiles } from "./signals/signalFiles.js";
import { summarizeTestChanges } from "./signals/testChanges.js";
import { matchTests } from "./signals/testMatch.js";
import { indexTouchedTestFiles } from "./signals/testPairs.js";
import { detectTI01 } from "./signals/ti01.js";
import { movedTestFiles } from "./signals/ti01Moved.js";
import { detectTI02 } from "./signals/ti02.js";
import { detectTI03 } from "./signals/ti03.js";
import { detectTI04 } from "./signals/ti04.js";
import { detectTI05 } from "./signals/ti05.js";
import { detectTI06 } from "./signals/ti06.js";
import { detectTI07 } from "./signals/ti07.js";
import { detectTI08 } from "./signals/ti08.js";
import { detectTI09 } from "./signals/ti09.js";
import { detectTI10 } from "./signals/ti10.js";
import { detectTI11 } from "./signals/ti11.js";
import { detectTI12 } from "./signals/ti12.js";
import { detectTI13 } from "./signals/ti13.js";
import { detectTI14 } from "./signals/ti14.js";
import { detectTI15 } from "./signals/ti15.js";
import { detectTI16 } from "./signals/ti16.js";
import { deletedTestFiles } from "./testFiles.js";
import type { PythonTestIndex } from "./testIndex/pythonSides.js";
import { resolveTestIntegrityMode, type TestIntegrityModeSettings } from "./testIntegrityMode.js";
import type { TestSources } from "./testSources.js";

/**
 * One coverage file of a multi-file input: its contents (and the path it came from, for messages); or the map an
 * adapter already parsed from it, with the format that was chosen on the start of that file (`empty` and `unknown`
 * included, with an empty map); or the path that was not found. The `format` of the enclosing input applies to text
 * entries only; a parsed entry carries its own. A parsed entry may also carry `skipped`, the number of malformed
 * records the adapter dropped while parsing it (from `readCoverageChunks`); absent means 0.
 */
export type CoverageFileInput =
  | { text: string; file?: string }
  | { parsed: CoverageMap; format: DetectedCoverageFormat; file?: string; skipped?: number }
  | { missingFile: string };

export interface CheckInput {
  version: string;
  /**
   * Coverage report contents (and, optionally, the path it was read from, for messages), or the
   * path that was looked for when it is missing; or several of them in the order they were read, which
   * are merged with hit counts summed. `format` applies to every file (`auto` detects it per file). Or the
   * not-found outcome of coverage auto-discovery (`chooseDiscoveredCoverage`), which reports that no report was
   * found at any of the candidate paths.
   */
  coverage:
    | { text: string; format: CoverageFormatSelection; file?: string }
    | { missingFile: string }
    | CoverageDiscoveryNotFound
    | { files: readonly CoverageFileInput[]; format: CoverageFormatSelection };
  /** Unified diff text, or the files an adapter already parsed from it, or why no diff is available. */
  diff: { text: string } | { parsed: readonly DiffFile[] } | { unavailable: string };
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
  /**
   * Sizes in bytes of tracked files in HEAD, from `git ls-tree -r -l` (see `parseLsTreeSizes`). A path missing
   * from the map has an unknown size; an absent map means sizes are unknown for every file.
   */
  repoFileBytes?: ReadonlyMap<string, number>;
  /** When true, a repo with no agent setup files fails the check. Off when absent. */
  requireAgentSetup?: boolean;
  /**
   * Agent tools the report names when no setup file configures them, from every source (config, flag, input).
   * Validated here against the fixed tool list; an unknown name throws a ConfigError. Absent or empty means
   * nothing is expected.
   */
  expectAgentSetup?: readonly string[];
  /**
   * Repo-relative directory that relative coverage paths start from (package-relative coverage in a
   * monorepo). Validated here; an invalid value throws a ConfigError. Absent means the repo root.
   */
  coverageRoot?: string;
  /**
   * Repo-relative path of the pharn-ci config in use (an absolute path under `repoRoot` is made relative; one
   * outside the repo matches no diff path). Absent means `.pharn/ci.yml`. Used only to warn when the change
   * under review edits it.
   */
  configPath?: string;
  /** Run metadata from the caller (the Action), copied into the report as given. Absent adds no `meta`. */
  meta?: ReportMeta;
  /**
   * The test-integrity mode settings: the `test-integrity` input (or flag) and `test_integrity.mode` from the
   * config. The input is the base (default `warn`); the config can only raise it. Absent means the default.
   */
  testIntegrityMode?: TestIntegrityModeSettings;
  /**
   * The text of the test and test-config files the change touches, at the merge base and at HEAD, gathered by the
   * CLI and the Action for the base-and-head test-integrity signals (TI02, TI05, TI06, TI09 and TI12). TI02, TI05, TI06
   * and TI12 compare the JS/TS (and, with `pythonTestIndex`, Python) test files the diff modifies; TI09 compares the
   * touched test-runner config files. TI03 reads the top-level imports of the Python test files in it, to resolve
   * `import pytest as pt` style aliases; without them it reads the literal spellings only. Without it, or in mode off,
   * nothing is compared and the report is the one it was before: no signal, no message, no language. With a side
   * unavailable and a modified test file, the report carries one `TEST_INTEGRITY_INDEX_UNAVAILABLE` message.
   */
  testSources?: TestSources;
  /**
   * The Python test index of the `.py` test files in `testSources` (see `pythonTestSourceFiles` and
   * `pythonTestIndexFromRun`), built by the CLI and the Action. Absent while `testSources` holds a modified `.py` test
   * file means no interpreter was found.
   */
  pythonTestIndex?: PythonTestIndex;
  /**
   * The text of the agent config files (the machine-readable agent setup kinds) as committed at HEAD, gathered by the
   * CLI and the Action for the secret scan of check A7: the files read and the files dropped with a reason, or why
   * none could be read. Absent means nothing is scanned and the report is the one it was: no message.
   */
  agentConfigSources?: AgentConfigSources;
  /**
   * The org policy of the run (see `ResolvedPolicy`), after `applyPolicy` gave the effective settings the other fields
   * carry. Its document runs the org-policy rules (P01, P08, P09, P10), its `unavailable` reason adds one
   * POLICY_UNAVAILABLE message, and the report carries a `policy` object for an app or file policy or an unavailable
   * one. Absent, or a policy of source `none` with no reason, adds nothing and the report is the one it was.
   */
  policy?: ResolvedPolicy;
  /**
   * The settings the policy beat or may not set (`PolicyApplication.ignored`). Together with the policy-file signal
   * severities that were lower than the computed ones, they add one POLICY_OVERRIDE_IGNORED message. Absent or empty adds nothing.
   */
  policyIgnored?: readonly IgnoredSetting[];
  /** Per-signal severities from the policy (`PolicyApplication.signalOverrides`), applied to the signals found. */
  signalOverrides?: SignalOverrides;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Signals sorted by id, then path, then line (none first), then detail, in code-unit order. */
function sortSignals(signals: TestIntegritySignal[]): TestIntegritySignal[] {
  return signals.sort(
    (a, b) =>
      byCodeUnit(a.id, b.id) ||
      byCodeUnit(a.path, b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      byCodeUnit(a.detail, b.detail),
  );
}

/** The whole pharn-ci check as one pure function: raw inputs in, Report v2 out. */
export function check(input: CheckInput): Report {
  // Validate before any early return, so a bad pattern is an error even when nothing else is computed.
  const matchers = [...new Set((input.exclude ?? []).map((p) => parseExcludePattern(p)))].map(compileGlob);
  const isExcluded = (path: string) => matchers.some((matches) => matches(path));
  const expectedAgentTools = parseAgentToolNames(input.expectAgentSetup ?? [], "expected agent tool");
  const coverageRoot =
    input.coverageRoot === undefined ? undefined : parseCoverageRoot(input.coverageRoot, "coverage root");
  const agentSetup = scanAgentSetup(input.repoFiles);
  // The change under review can edit the inputs of its own grade or delete the tests that guard it; these
  // findings (gate inputs and deleted test files) ride on every report path where the diff is available.
  const parsedDiff =
    "text" in input.diff
      ? parseUnifiedDiff(input.diff.text, { keepText: keepSignalFileText(input.configPath, input.repoRoot) })
      : "parsed" in input.diff
        ? input.diff.parsed
        : null;
  const configPaths = parsedDiff === null ? [] : changedConfigPaths(parsedDiff, input.configPath, input.repoRoot);
  const testPaths = parsedDiff === null ? [] : deletedTestFiles(parsedDiff);
  const testIntegrity = resolveTestIntegrityMode(input.testIntegrityMode);
  // The touched test files are indexed once, only with the sources, a diff and a mode that is not off: the
  // base-and-head signals compare them, and TI01 reads which deleted test files moved.
  const touched =
    parsedDiff !== null && testIntegrity.mode !== "off" && input.testSources !== undefined
      ? indexTouchedTestFiles(parsedDiff, input.testSources, input.pythonTestIndex)
      : null;
  const movedTests =
    touched === null || parsedDiff === null || input.testSources === undefined
      ? undefined
      : movedTestFiles(parsedDiff, input.testSources, input.pythonTestIndex, touched);
  // Mode off computes nothing; the signals carry their effective severity for the mode.
  const sourceMatches =
    parsedDiff === null || testIntegrity.mode === "off"
      ? { signals: [], omitted: [] }
      : detectTI15(parsedDiff, { repoFiles: input.repoFiles });
  const testIntegritySignals =
    parsedDiff === null || testIntegrity.mode === "off"
      ? []
      : sortSignals([
          ...detectTI01(parsedDiff, testIntegrity.mode, movedTests?.files, movedTests?.compared),
          ...detectTI03(parsedDiff, testIntegrity.mode, input.testSources),
          ...detectTI04(parsedDiff, testIntegrity.mode),
          ...detectTI08(parsedDiff),
          ...detectTI10(parsedDiff, { repoFiles: input.repoFiles, mode: testIntegrity.mode }),
          ...detectTI11(parsedDiff, testIntegrity.mode),
          ...detectTI13(parsedDiff, testIntegrity.mode),
          ...detectTI14(parsedDiff, {
            configPath: input.configPath,
            repoRoot: input.repoRoot,
            exclude: input.exclude ?? [],
            mode: testIntegrity.mode,
          }),
          ...sourceMatches.signals,
          ...detectTI16(parsedDiff),
        ]);
  // The base-and-head signals: the touched test files are compared between the merge base and HEAD. Only with the
  // sources, a diff and a mode that is not off; otherwise nothing runs and the report is the one it was.
  let comparison: {
    signals: TestIntegritySignal[];
    omitted: OmittedSignals[];
    languages: Array<"ts" | "js" | "py">;
    unavailable: TestIndexUnavailable | undefined;
    configUnavailable: TestConfigUnavailable | undefined;
  } | null = null;
  const comparedMode = testIntegrity.mode;
  let testChanges: ReportTestChanges | undefined;
  if (parsedDiff !== null && comparedMode !== "off" && input.testSources !== undefined && touched !== null) {
    const configs = detectTI09(parsedDiff, input.testSources, comparedMode);
    const configUnavailable: TestConfigUnavailable | undefined =
      configs.notRun !== null
        ? { notRun: configs.notRun }
        : configs.unavailable.length > 0
          ? { files: configs.unavailable }
          : undefined;
    if (touched.notRun !== null) {
      const capped = capFindings(configs.signals);
      comparison = {
        signals: capped.kept,
        omitted: capped.omitted,
        languages: [],
        unavailable: { notRun: touched.notRun },
        configUnavailable,
      };
    } else {
      const match = matchTests(touched);
      testChanges = summarizeTestChanges(touched, match) ?? undefined;
      // A test of a deleted file that TI01 found again in another file is judged like any other pair, unless the match
      // already pairs that head test.
      const matchedHeads = new Set([...match.pairs, ...match.moved, ...match.replaced].map((pair) => pair.head));
      const movedPairs = (movedTests?.pairs ?? []).filter((pair) => !matchedHeads.has(pair.head));
      const judged = movedPairs.length === 0 ? match : { ...match, pairs: [...match.pairs, ...movedPairs] };
      const capped = capFindings([
        ...detectTI02(match, comparedMode),
        ...detectTI05(judged, comparedMode),
        ...detectTI06(judged),
        ...detectTI07(judged, parsedDiff),
        ...detectTI12(touched, parsedDiff),
        ...configs.signals,
      ]);
      comparison = {
        signals: capped.kept,
        omitted: capped.omitted,
        languages: touched.languages,
        unavailable: touched.unavailable.length > 0 ? { files: touched.unavailable } : undefined,
        configUnavailable,
      };
    }
  }
  if (comparison !== null && comparison.signals.length > 0) {
    testIntegritySignals.push(...comparison.signals);
    sortSignals(testIntegritySignals);
  }
  // A file whose kept text was cut can hide a finding past the cut; the report names it rather than stay silent.
  const textTruncatedFiles =
    parsedDiff === null || testIntegrity.mode === "off"
      ? []
      : textCutSignalFiles(parsedDiff, input.configPath, input.repoRoot);
  // The single-file forms are several files with one entry, so there is one path through the check.
  const coverageInput = input.coverage;
  let files: readonly CoverageFileInput[];
  let selection: CoverageFormatSelection;
  if ("files" in coverageInput) {
    files = coverageInput.files;
    selection = coverageInput.format;
  } else if ("missingFile" in coverageInput) {
    files = [coverageInput];
    selection = "auto";
  } else if ("kind" in coverageInput) {
    // Discovery found no report: there is no file to read or name.
    files = [];
    selection = "auto";
  } else {
    files = [
      coverageInput.file === undefined
        ? { text: coverageInput.text }
        : { text: coverageInput.text, file: coverageInput.file },
    ];
    selection = coverageInput.format;
  }

  // With several files, the first tracked one is named: one is enough for the change to grade itself.
  let trackedCoverage: string | null = null;
  for (const file of files) {
    if ("missingFile" in file) continue;
    trackedCoverage = trackedCoverageFile(file.file, input.repoRoot, input.repoFiles);
    if (trackedCoverage !== null) break;
  }
  const bytes = input.repoFileBytes;
  const emptyAgentSetupFiles =
    bytes === undefined ? [] : agentSetup.files.filter((file) => bytes.get(file.path) === 0).map((file) => file.path);
  const omittedBeforePolicy: OmittedSignals[] = [...(comparison?.omitted ?? []), ...sourceMatches.omitted];
  // Per-signal severities from the org policy, applied to what the detectors computed (mode off computed nothing).
  const overridden =
    input.signalOverrides === undefined || testIntegrity.mode === "off"
      ? undefined
      : applySignalOverrides(testIntegritySignals, omittedBeforePolicy, input.signalOverrides, testIntegrity.mode);
  const finalSignals = overridden?.signals ?? testIntegritySignals;
  const omittedSignals = overridden?.omitted ?? omittedBeforePolicy;
  // The org-policy rules (P01, P08, P09, P10) run once, only when a policy was asked for.
  const policyEvaluation =
    input.policy === undefined
      ? null
      : evaluatePolicyRules({
          policy: input.policy,
          agentSetupFileCount: agentSetup.files.length,
          agentTools: summarizeAgentSetup(agentSetup.files).tools,
          repoFiles: input.repoFiles,
          diff: parsedDiff,
          configPath: configRepoPath(input.configPath, input.repoRoot),
          ignored: input.policyIgnored ?? [],
        });
  // The settings a policy beat, and the policy-file severities that were lower than the computed ones (signals and
  // rules), as one message.
  const policyIgnored: IgnoredSetting[] = [
    ...(input.policyIgnored ?? []),
    ...(overridden?.lowered ?? []).map(
      (id): IgnoredSetting => ({ setting: `test_integrity.signals.${id}`, layer: "policy-file", reason: "looser" }),
    ),
    ...(policyEvaluation?.lowered ?? []).map(
      (id): IgnoredSetting => ({ setting: `policy.rules.${id}`, layer: "policy-file", reason: "looser" }),
    ),
  ];
  const policyMessages: Message[] = [
    ...(input.policy?.unavailable === undefined ? [] : [policyUnavailableMessage(input.policy.unavailable)]),
    ...(policyEvaluation === null ? [] : policyRuleMessages(policyEvaluation)),
    ...(policyIgnored.length === 0 ? [] : [policyOverrideIgnoredMessage(policyIgnored)]),
  ];
  // P01 sets the levels of the agent setup messages for the settings the policy requires.
  const p01 = (policyEvaluation?.violations ?? []).filter((violation) => violation.id === "P01");
  const noFilesViolation = p01.find((violation) => violation.detail === NO_SETUP_DETAIL);
  const expectedViolations = p01.filter((violation) => violation.detail !== NO_SETUP_DETAIL);
  const agentSetupLevels: NonNullable<Parameters<typeof buildReport>[0]["agentSetupLevels"]> = {
    ...(noFilesViolation === undefined ? {} : { noFiles: levelOf(noFilesViolation.severity) }),
    ...(expectedViolations.length === 0
      ? {}
      : { expectedMissing: levelOf(strongest(expectedViolations.map((violation) => violation.severity))) }),
  };
  // With the policy's expected tools in the report, a direct caller that did not pass them as `expectAgentSetup` still
  // gets the expected-tools message (and the verdict) for a P01 violation.
  const reportedTools =
    agentSetupLevels.expectedMissing === undefined
      ? expectedAgentTools
      : [...new Set([...expectedAgentTools, ...(input.policy?.document?.setup?.expect ?? [])])];
  // The report's `policy` object: for an app or file policy, or an unavailable one; not for a bare `none`.
  const policySource = input.policy?.source;
  const reportPolicy: ReportPolicy | undefined =
    input.policy === undefined || policyEvaluation === null
      ? undefined
      : policySource === "app" || policySource === "file" || input.policy.unavailable !== undefined
        ? {
            source: policySource === "app" ? "app" : policySource === "file" ? "input" : "none",
            version: policySource === "app" ? input.policy.version : null,
            ...(policySource === "app" && input.policy.fetchedAt !== undefined
              ? { fetchedAt: input.policy.fetchedAt }
              : {}),
            violations: policyEvaluation.violations.map(({ id, severity, path, line, detail }) => ({
              id,
              severity,
              path,
              line,
              detail,
            })),
          }
        : undefined;
  // Check A7 does not depend on the mode or the diff: it rides on every report path, and only the sources start it.
  const agentConfigMessages =
    input.agentConfigSources === undefined
      ? []
      : agentConfigSecretMessages(input.agentConfigSources, agentConfigSecretPaths(agentSetup));
  const base = {
    version: input.version,
    threshold: input.threshold,
    agentSetup,
    requireAgentSetup: input.requireAgentSetup === true,
    ...(reportedTools.length > 0 ? { expectedAgentTools: reportedTools } : {}),
    ...(Object.keys(agentSetupLevels).length > 0 ? { agentSetupLevels } : {}),
    ...(reportPolicy === undefined ? {} : { policy: reportPolicy }),
    ...(configPaths.length > 0 ? { changedConfigPaths: configPaths } : {}),
    ...(testPaths.length > 0 ? { deletedTestFiles: testPaths } : {}),
    ...(trackedCoverage === null ? {} : { trackedCoverageFile: trackedCoverage }),
    ...(emptyAgentSetupFiles.length > 0 ? { emptyAgentSetupFiles } : {}),
    ...(input.meta === undefined ? {} : { meta: input.meta }),
    testIntegrity,
    ...(finalSignals.length > 0 ? { testIntegritySignals: finalSignals } : {}),
    ...(textTruncatedFiles.length > 0 ? { textTruncatedFiles } : {}),
    ...(comparison === null || comparison.languages.length === 0
      ? {}
      : { testIntegrityLanguages: comparison.languages }),
    ...(omittedSignals.length === 0 ? {} : { omittedSignals }),
    ...(comparison?.unavailable === undefined ? {} : { testIndexUnavailable: comparison.unavailable }),
    ...(testChanges === undefined ? {} : { testChanges }),
    ...(comparison?.configUnavailable === undefined ? {} : { testConfigUnavailable: comparison.configUnavailable }),
    ...(agentConfigMessages.length === 0 ? {} : { agentConfigSecretMessages: agentConfigMessages }),
    ...(policyMessages.length === 0 ? {} : { policyMessages }),
  };

  if ("kind" in coverageInput) {
    return buildReport({ ...base, diffCoverage: null, missing: { reason: "coverage-not-discovered" } });
  }
  for (const file of files) {
    if ("missingFile" in file) {
      return buildReport({
        ...base,
        diffCoverage: null,
        missing: { reason: "coverage-file-missing", coverageFile: file.missingFile },
      });
    }
  }
  if ("unavailable" in input.diff) {
    return buildReport({
      ...base,
      diffCoverage: null,
      missing: { reason: "diff-unavailable", detail: input.diff.unavailable },
    });
  }

  // Each file in order, with its own format under `auto`; the first bad one is the one reported.
  const maps: CoverageMap[] = [];
  const formats = new Set<CoverageFormat>();
  let skippedLines = 0;
  for (const file of files) {
    if ("missingFile" in file) continue;
    const coverageFile = file.file ?? null;
    const choice = "parsed" in file ? { format: file.format } : chooseCoverageFormat(file.text, selection);
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
    let parsed: CoverageMap;
    if ("parsed" in file) {
      parsed = file.parsed;
      const count = file.skipped;
      if (count !== undefined && Number.isSafeInteger(count) && count > 0) skippedLines += count;
    } else {
      const counted = parseCoverageCounted(file.text, choice.format, {
        ...(input.repoRoot === undefined ? {} : { repoRoot: input.repoRoot }),
        ...(coverageRoot === undefined ? {} : { coverageRoot }),
      });
      parsed = counted.map;
      skippedLines += counted.skipped;
    }
    // An empty or unreadable report would otherwise make every change look uncovered-but-untracked
    // and pass as NO_COVERABLE_CHANGES. Say so instead.
    if (parsed.size === 0) {
      return buildReport({
        ...base,
        diffCoverage: null,
        missing: { reason: "coverage-file-empty", coverageFile },
      });
    }
    formats.add(choice.format);
    maps.push(parsed);
  }
  // No file at all cannot be told from an unreadable one: fail closed.
  if (maps.length === 0) {
    return buildReport({
      ...base,
      diffCoverage: null,
      missing: { reason: "coverage-file-empty", coverageFile: null },
    });
  }
  const coverage = mergeCoverageMaps(maps);
  // The report names one format only when every file was read as that format.
  const [onlyFormat] = formats;
  const coverageFormat = formats.size === 1 ? onlyFormat : undefined;
  // The diff text was parsed up front; `diff` is only unavailable on the early return above.
  const diff = parsedDiff ?? [];
  const binaryPaths = binaryCoveredPaths(diff, coverage);
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
        ...(binaryPaths.length > 0 ? { binaryCoveredPaths: binaryPaths } : {}),
      });
    }
    untrackedCoveragePaths = match.unmatched.length;
  }
  return buildReport({
    ...base,
    ...(coverageFormat === undefined ? {} : { coverageFormat }),
    diffCoverage: computeDiffCoverage(diff, coverage, input.threshold, isExcluded),
    ...(untrackedCoveragePaths > 0 ? { untrackedCoveragePaths } : {}),
    ...(skippedLines > 0 ? { skippedCoverageLines: skippedLines } : {}),
    ...(binaryPaths.length > 0 ? { binaryCoveredPaths: binaryPaths } : {}),
  });
}
