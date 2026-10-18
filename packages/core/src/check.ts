import { parseCoverageRoot, parseExcludePattern } from "./config.js";
import { chooseCoverageFormat } from "./coverage/detect.js";
import { parseCoverage } from "./coverage/index.js";
import { matchCoveragePaths } from "./coverage/match.js";
import { mergeCoverageMaps } from "./coverage/merge.js";
import type { CoverageFormat, CoverageFormatSelection, CoverageMap } from "./coverage/types.js";
import { parseUnifiedDiff } from "./diff/unified.js";
import { computeDiffCoverage } from "./diffCoverage.js";
import { binaryCoveredPaths, changedConfigPaths, trackedCoverageFile } from "./gateInputs.js";
import { compileGlob } from "./glob.js";
import { buildReport, type Report } from "./report.js";
import { scanAgentSetup } from "./setup/scan.js";
import { deletedTestFiles } from "./testFiles.js";

/** One coverage file of a multi-file input: its contents (and the path it came from, for messages), or the path that was not found. */
export type CoverageFileInput = { text: string; file?: string } | { missingFile: string };

export interface CheckInput {
  version: string;
  /**
   * Coverage report contents (and, optionally, the path it was read from, for messages), or the
   * path that was looked for when it is missing; or several of them in the order they were read, which
   * are merged with hit counts summed. `format` applies to every file (`auto` detects it per file).
   */
  coverage:
    | { text: string; format: CoverageFormatSelection; file?: string }
    | { missingFile: string }
    | { files: readonly CoverageFileInput[]; format: CoverageFormatSelection };
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
  /**
   * Sizes in bytes of tracked files in HEAD, from `git ls-tree -r -l` (see `parseLsTreeSizes`). A path missing
   * from the map has an unknown size; an absent map means sizes are unknown for every file.
   */
  repoFileBytes?: ReadonlyMap<string, number>;
  /** When true, a repo with no agent setup files fails the check. Off when absent. */
  requireAgentSetup?: boolean;
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
}

/** The whole pharn-ci check as one pure function: raw inputs in, Report v1 out. */
export function check(input: CheckInput): Report {
  // Validate before any early return, so a bad pattern is an error even when nothing else is computed.
  const matchers = [...new Set((input.exclude ?? []).map((p) => parseExcludePattern(p)))].map(compileGlob);
  const isExcluded = (path: string) => matchers.some((matches) => matches(path));
  const coverageRoot =
    input.coverageRoot === undefined ? undefined : parseCoverageRoot(input.coverageRoot, "coverage root");
  const agentSetup = scanAgentSetup(input.repoFiles);
  // The change under review can edit the inputs of its own grade or delete the tests that guard it; these
  // findings (gate inputs and deleted test files) ride on every report path where the diff is available.
  const parsedDiff = "text" in input.diff ? parseUnifiedDiff(input.diff.text) : null;
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
    if (!("text" in file)) continue;
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
    ...(configPaths.length > 0 ? { changedConfigPaths: configPaths } : {}),
    ...(testPaths.length > 0 ? { deletedTestFiles: testPaths } : {}),
    ...(trackedCoverage === null ? {} : { trackedCoverageFile: trackedCoverage }),
    ...(emptyAgentSetupFiles.length > 0 ? { emptyAgentSetupFiles } : {}),
  };

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
  for (const file of files) {
    if ("missingFile" in file) continue;
    const coverageFile = file.file ?? null;
    const choice = chooseCoverageFormat(file.text, selection);
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
    const parsed = parseCoverage(file.text, choice.format, {
      ...(input.repoRoot === undefined ? {} : { repoRoot: input.repoRoot }),
      ...(coverageRoot === undefined ? {} : { coverageRoot }),
    });
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
    ...(binaryPaths.length > 0 ? { binaryCoveredPaths: binaryPaths } : {}),
  });
}
