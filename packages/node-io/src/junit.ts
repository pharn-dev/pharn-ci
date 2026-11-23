import {
  type DirEntry,
  JUNIT_MAX_FILES,
  JUNIT_MAX_TOTAL_BYTES,
  type JunitSources,
  parseExcludePattern,
  utf8ByteLength,
  type WalkBudget,
  WalkLimitError,
  walkGlob,
} from "@pharn-ci/core";

/** The most files the JUnit glob walk may match, all patterns together, before the 50-file cap picks the first ones. */
const MAX_JUNIT_GLOB_FILES = 1000;
/** The most directory entries the JUnit glob walk may visit, all patterns together. */
const MAX_JUNIT_WALK_ENTRIES = 100_000;

/** What reading JUnit files needs from the deps of the CLI or the Action. */
export interface JunitReadDeps {
  listDir(path: string): Promise<DirEntry[] | null>;
  readFileStream(path: string): Promise<AsyncIterable<string> | null>;
  resolvePath(...segments: string[]): string;
}

export interface ReadJunitFilesOptions {
  /** The patterns as given (the `junit-paths` input split, or the `--junit` flags). */
  patterns: readonly string[];
  /** The input's name in ConfigError messages. */
  label: string;
  /** What the patterns are relative to: the workspace in the Action, the working directory in the CLI. */
  baseDir: string;
}

/**
 * The JUnit files of the patterns, read for `parseJunitSources`. Every pattern is checked with the exclusion rules
 * (relative, no `..` segment, no leading `/`, only `*`, `**` and `?`), so a path outside `baseDir` is refused with a
 * ConfigError. A plain path is a pattern that matches itself. Each pattern is walked over directory listings that report
 * a symbolic link and never follow it, so neither a linked file nor a linked directory is read. The matches are taken
 * in pattern order, each pattern's sorted, each file once; the first 50 are read, in order, until 25 MiB of text are
 * read in all: the file that goes past it and every later one are dropped unread (a file is read as a stream and given
 * up as soon as the total is over). A walk past its limit stops the search and is reported as `walkLimit`.
 */
export async function readJunitFiles(deps: JunitReadDeps, options: ReadJunitFilesOptions): Promise<JunitSources> {
  const { paths, walkLimit } = await matchJunitFiles(deps, options);
  const files: Array<JunitSources["files"][number]> = [];
  let bytes = 0;
  let overBytes = false;
  for (const [index, path] of paths.entries()) {
    if (index >= JUNIT_MAX_FILES) {
      files.push({ path, dropped: "file-cap" });
      continue;
    }
    if (overBytes) {
      files.push({ path, dropped: "byte-cap" });
      continue;
    }
    const chunks = await deps.readFileStream(deps.resolvePath(options.baseDir, path));
    // Listed a moment ago: a file that is gone now was not written by the test step, so it is not a JUnit file.
    if (chunks === null) continue;
    const parts: string[] = [];
    for await (const chunk of chunks) {
      bytes += utf8ByteLength(chunk);
      if (bytes > JUNIT_MAX_TOTAL_BYTES) {
        overBytes = true;
        break;
      }
      parts.push(chunk);
    }
    files.push(overBytes ? { path, dropped: "byte-cap" } : { path, text: parts.join("") });
  }
  return walkLimit ? { files, walkLimit } : { files };
}

/** The files the JUnit patterns match, in the order `readJunitFiles` reads them, and whether the walk hit its limit. */
export interface JunitMatches {
  paths: string[];
  walkLimit: boolean;
}

/**
 * The paths (relative to `baseDir`) the patterns match, without reading any file: each pattern checked with the
 * exclusion rules (a ConfigError otherwise), walked over listings that never follow a symbolic link, the matches taken in
 * pattern order, each pattern's sorted, each file once. A walk past its limit stops the search (`walkLimit`). This is the
 * list `readJunitFiles` reads from; `pharn-ci test` also takes it before the command runs, to tell a stale file.
 */
export async function matchJunitFiles(
  deps: Pick<JunitReadDeps, "listDir" | "resolvePath">,
  options: ReadJunitFilesOptions,
): Promise<JunitMatches> {
  const patterns = options.patterns.map((pattern) => parseExcludePattern(pattern, options.label));
  const budget: WalkBudget = { files: 0, entries: 0 };
  const limits = { files: MAX_JUNIT_GLOB_FILES, entries: MAX_JUNIT_WALK_ENTRIES };
  const listDir = (dir: string) => deps.listDir(deps.resolvePath(options.baseDir, dir));
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    let found: string[];
    try {
      found = await walkGlob(pattern, listDir, budget, limits);
    } catch (err) {
      if (!(err instanceof WalkLimitError)) throw err;
      return { paths, walkLimit: true };
    }
    for (const path of found) {
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }
  return { paths, walkLimit: false };
}
