import { check as checkParsed } from "../src/check.js";
import { parseCoverageRoot } from "../src/config.js";
import { chooseCoverageFormat } from "../src/coverage/detect.js";
import { parseCoverageCounted } from "../src/coverage/index.js";
import type { CoverageFormatSelection } from "../src/coverage/types.js";
import type { CheckInput, CoverageFileInput, Report } from "../src/index.js";

// CORE-143 (item 4): check() takes parsed coverage only, as the CLI and the Action pass it (`readCoverageFiles` parses
// each file while it reads it). Tests that hold a coverage report as text use this `check`, which parses the text first
// with the same core functions and options check() used before, then calls check().

/** One coverage report as text, and the path it came from (for messages). */
type TextFile = { text: string; file?: string };

/** `CheckInput` with coverage as text too: one report, or several (text and parsed entries mixed). */
export type TextCheckInput = Omit<CheckInput, "coverage"> & {
  coverage:
    | CheckInput["coverage"]
    | (TextFile & { format: CoverageFormatSelection })
    | { files: readonly (CoverageFileInput | TextFile)[]; format?: CoverageFormatSelection };
};

/**
 * One report's text as the parsed entry check() takes: the format chosen on its start (`auto` detects it), its records
 * parsed against the repo root and the coverage root with literal backslashes kept, and the malformed ones counted.
 */
export function parsedCoverageFile(
  text: string,
  selection: CoverageFormatSelection,
  options: { repoRoot?: string | undefined; coverageRoot?: string | undefined; file?: string | undefined } = {},
): CoverageFileInput {
  const { format } = chooseCoverageFormat(text, selection);
  if (format === "empty" || format === "unknown") return { parsed: new Map(), format, file: options.file };
  const counted = parseCoverageCounted(text, format, {
    ...(options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot }),
    ...(options.coverageRoot === undefined ? {} : { coverageRoot: options.coverageRoot }),
    literalBackslashes: true,
  });
  return { parsed: counted.map, format, file: options.file, skipped: counted.skipped };
}

/** check() for a test that holds its coverage as text: the text is parsed first, then check() runs on the result. */
export function check(input: TextCheckInput): Report {
  const { coverage } = input;
  if ("missingFile" in coverage || "kind" in coverage) return checkParsed({ ...input, coverage });
  let root: string | undefined;
  try {
    root = input.coverageRoot === undefined ? undefined : parseCoverageRoot(input.coverageRoot, "coverage root");
  } catch {
    // check() throws the same ConfigError, after the checks it makes first.
    return checkParsed({ ...input, coverage: { files: [] } });
  }
  const parse = (entry: TextFile, selection: CoverageFormatSelection) =>
    parsedCoverageFile(entry.text, selection, { repoRoot: input.repoRoot, coverageRoot: root, file: entry.file });
  const files =
    "files" in coverage
      ? coverage.files.map((entry) =>
          "text" in entry ? parse(entry, ("format" in coverage ? coverage.format : undefined) ?? "auto") : entry,
        )
      : [parse(coverage, coverage.format)];
  return checkParsed({ ...input, coverage: { files } });
}
