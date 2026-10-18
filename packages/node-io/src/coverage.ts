import {
  type CoverageEntry,
  type CoverageFileInput,
  type CoverageFormatSelection,
  coverageChoiceLine,
  coverageEntryList,
  type DirEntry,
  expandCoverageEntries,
  parseCoverageEntries,
  readCoverageChunks,
} from "@pharn-ci/core";
import { fileChunks } from "./chunks.js";

/** What reading coverage files needs from the deps of the CLI or the Action. */
export interface CoverageReadDeps {
  listDir(path: string): Promise<DirEntry[] | null>;
  readFile(path: string): Promise<string | null>;
  readFileStream?(path: string): Promise<AsyncIterable<string> | null>;
  resolvePath(...segments: string[]): string;
}

export interface ReadCoverageFilesOptions {
  /** The resolved coverage-file setting; `coverageEntryList` is applied inside. */
  entries: string | readonly string[];
  /** The input's name in ConfigError messages. */
  label: string;
  /** What relative entries start from. */
  baseDir: string;
  format: CoverageFormatSelection;
  repoRoot: string;
  coverageRoot?: string;
  /** How an entry, glob or match (relative to `baseDir`) is named in `missingFile` and `file`. */
  name(entry: string): string;
  /** Called once per file read, with `coverageChoiceLine`'s text. */
  log(line: string): void;
  /**
   * Take every entry as a literal path, even one with glob characters (`*`, `?`, `[`, `]`, `{`, `}`): for paths
   * that were found on disk rather than written by the user. Absent or false: entries are parsed as globs.
   */
  literal?: boolean;
}

/**
 * Every coverage entry resolved and every file read and parsed as it is read; a file reached twice is read once.
 * A glob with no match and a file that does not exist give a `missingFile` entry.
 */
export async function readCoverageFiles(
  deps: CoverageReadDeps,
  options: ReadCoverageFilesOptions,
): Promise<CoverageFileInput[]> {
  const { label, baseDir, format, repoRoot, coverageRoot, name, log } = options;
  const entryList = coverageEntryList(options.entries);
  const entries =
    options.literal === true
      ? entryList.map((entry): CoverageEntry => ({ kind: "literal", entry }))
      : parseCoverageEntries(entryList, label);
  const expanded = await expandCoverageEntries(entries, (dir) => deps.listDir(deps.resolvePath(baseDir, dir)), label);
  const coverageFiles: CoverageFileInput[] = [];
  const seen = new Set<string>();
  for (const item of expanded) {
    if (item.kind === "no-match") {
      coverageFiles.push({ missingFile: name(item.glob) });
      continue;
    }
    const entry = item.kind === "literal" ? item.entry : item.path;
    const coveragePath = deps.resolvePath(baseDir, entry);
    if (seen.has(coveragePath)) continue;
    seen.add(coveragePath);
    const chunks = await fileChunks(deps, coveragePath);
    if (chunks === null) {
      coverageFiles.push({ missingFile: name(entry) });
      continue;
    }
    // The file is parsed as it is read, with the same repo root and coverage root the check would use.
    const { choice, parsed } = await readCoverageChunks(chunks, format, {
      repoRoot,
      ...(coverageRoot === undefined ? {} : { coverageRoot }),
    });
    log(coverageChoiceLine(choice));
    coverageFiles.push({ parsed, format: choice.format, file: name(entry) });
  }
  return coverageFiles;
}
