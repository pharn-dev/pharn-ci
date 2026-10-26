import { parseAgentToolNames, parseCoverageRoot, parseExcludePattern } from "./config.js";
import { chooseCoverageFormat, type DetectedCoverageFormat } from "./coverage/detect.js";
import { parseCoverageCounted } from "./coverage/index.js";
import { matchCoveragePaths } from "./coverage/match.js";
import { mergeCoverageMaps } from "./coverage/merge.js";
import type { CoverageFormat, CoverageFormatSelection, CoverageMap } from "./coverage/types.js";
import type { CoverageDiscoveryNotFound } from "./coverageDiscovery.js";
import { type DiffFile, parseUnifiedDiff } from "./diff/unified.js";
import { computeDiffCoverage } from "./diffCoverage.js";
import { binaryCoveredPaths, changedConfigPaths, trackedCoverageFile } from "./gateInputs.js";
import { compileGlob } from "./glob.js";
import {
  buildReport,
  type OmittedSignals,
  type Report,
  type ReportMeta,
  type ReportTestChanges,
  type TestConfigUnavailable,
  type TestIndexUnavailable,
  type TestIntegritySignal,
} from "./report.js";
import { scanAgentSetup } from "./setup/scan.js";
import { capFindings } from "./signals/findingCap.js";
import { keepSignalFileText, textCutSignalFiles } from "./signals/signalFiles.js";
import { summarizeTestChanges } from "./signals/testChanges.js";
import { matchTests } from "./signals/testMatch.js";
import { indexTouchedTestFiles } from "./signals/testPairs.js";
import { detectTI01 } from "./signals/ti01.js";
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
  // Mode off computes nothing; the signals carry their effective severity for the mode.
  const sourceMatches =
    parsedDiff === null || testIntegrity.mode === "off"
      ? { signals: [], omitted: [] }
      : detectTI15(parsedDiff, { repoFiles: input.repoFiles });
  const testIntegritySignals =
    parsedDiff === null || testIntegrity.mode === "off"
      ? []
      : sortSignals([
          ...detectTI01(parsedDiff, testIntegrity.mode),
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
  if (parsedDiff !== null && comparedMode !== "off" && input.testSources !== undefined) {
    const touched = indexTouchedTestFiles(parsedDiff, input.testSources, input.pythonTestIndex);
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
      const capped = capFindings([
        ...detectTI02(match, comparedMode),
        ...detectTI05(match, comparedMode),
        ...detectTI06(match),
        ...detectTI07(match, parsedDiff),
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
  const omittedSignals: OmittedSignals[] = [...(comparison?.omitted ?? []), ...sourceMatches.omitted];
  const base = {
    version: input.version,
    threshold: input.threshold,
    agentSetup,
    requireAgentSetup: input.requireAgentSetup === true,
    ...(expectedAgentTools.length > 0 ? { expectedAgentTools } : {}),
    ...(configPaths.length > 0 ? { changedConfigPaths: configPaths } : {}),
    ...(testPaths.length > 0 ? { deletedTestFiles: testPaths } : {}),
    ...(trackedCoverage === null ? {} : { trackedCoverageFile: trackedCoverage }),
    ...(emptyAgentSetupFiles.length > 0 ? { emptyAgentSetupFiles } : {}),
    ...(input.meta === undefined ? {} : { meta: input.meta }),
    testIntegrity,
    ...(testIntegritySignals.length > 0 ? { testIntegritySignals } : {}),
    ...(textTruncatedFiles.length > 0 ? { textTruncatedFiles } : {}),
    ...(comparison === null || comparison.languages.length === 0
      ? {}
      : { testIntegrityLanguages: comparison.languages }),
    ...(omittedSignals.length === 0 ? {} : { omittedSignals }),
    ...(comparison?.unavailable === undefined ? {} : { testIndexUnavailable: comparison.unavailable }),
    ...(testChanges === undefined ? {} : { testChanges }),
    ...(comparison?.configUnavailable === undefined ? {} : { testConfigUnavailable: comparison.configUnavailable }),
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
