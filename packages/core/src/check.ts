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
import { buildReport, type Report, type ReportMeta } from "./report.js";
import { scanAgentSetup } from "./setup/scan.js";
import { deletedTestFiles } from "./testFiles.js";
import { resolveTestIntegrityMode, type TestIntegrityModeSettings } from "./testIntegrityMode.js";

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
    "text" in input.diff ? parseUnifiedDiff(input.diff.text) : "parsed" in input.diff ? input.diff.parsed : null;
  const configPaths = parsedDiff === null ? [] : changedConfigPaths(parsedDiff, input.configPath, input.repoRoot);
  const testPaths = parsedDiff === null ? [] : deletedTestFiles(parsedDiff);
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
    testIntegrity: resolveTestIntegrityMode(input.testIntegrityMode),
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
