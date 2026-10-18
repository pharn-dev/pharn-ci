import { ConfigError, parseExcludePattern } from "./config.js";
import { hasGlobSyntax } from "./glob.js";
import { type ListDir, type WalkBudget, WalkLimitError, walkGlob } from "./globWalk.js";

/** The most coverage files one run may match through globs. */
export const MAX_COVERAGE_GLOB_FILES = 1000;
/** The most directory entries one run may visit while looking for coverage files. */
export const MAX_COVERAGE_WALK_ENTRIES = 100_000;

/**
 * A coverage entry from the flag, the input or the config: a literal path, handled as given, or a glob
 * (any entry with `*`, `?`, `[`, `]`, `{` or `}`), validated with the exclusion rules.
 */
export type CoverageEntry = { kind: "literal"; entry: string } | { kind: "glob"; entry: string; pattern: string };

/** What an entry turned into once its glob was walked. `glob` is the entry as given; `path` is base-relative. */
export type ExpandedCoverageEntry =
  | { kind: "literal"; entry: string }
  | { kind: "match"; glob: string; path: string }
  | { kind: "no-match"; glob: string };

/** The entries of a coverage setting: a single string is a list of one. */
export function coverageEntryList(path: string | readonly string[]): string[] {
  return typeof path === "string" ? [path] : [...path];
}

/**
 * Classify the entries and validate every glob. Throws a ConfigError naming `label` and the entry for a glob
 * the matcher does not support. Idempotent on entries that were already validated.
 */
export function parseCoverageEntries(entries: readonly string[], label: string): CoverageEntry[] {
  return entries.map((entry): CoverageEntry => {
    if (!hasGlobSyntax(entry)) return { kind: "literal", entry };
    return { kind: "glob", entry, pattern: parseExcludePattern(entry, label) };
  });
}

/**
 * Walk every glob in entry order through `listDir`, sharing one budget for the whole call: the limits are
 * totals for the run. A literal passes through; a glob gives its matches sorted by path, or one `no-match`.
 * Going over a limit throws a ConfigError naming `label` and the glob.
 */
export async function expandCoverageEntries(
  entries: readonly CoverageEntry[],
  listDir: ListDir,
  label: string,
): Promise<ExpandedCoverageEntry[]> {
  const budget: WalkBudget = { files: 0, entries: 0 };
  const limits = { files: MAX_COVERAGE_GLOB_FILES, entries: MAX_COVERAGE_WALK_ENTRIES };
  const expanded: ExpandedCoverageEntry[] = [];
  for (const item of entries) {
    if (item.kind === "literal") {
      expanded.push(item);
      continue;
    }
    let paths: string[];
    try {
      paths = await walkGlob(item.pattern, listDir, budget, limits);
    } catch (err) {
      if (!(err instanceof WalkLimitError)) throw err;
      throw new ConfigError(
        err.limit === "files"
          ? `${label} "${item.entry}" matched more than 1,000 files; the limit is 1,000 coverage files per run`
          : `${label} "${item.entry}": the glob walk limit was exceeded (more than 100,000 directory entries visited in one run)`,
      );
    }
    if (paths.length === 0) expanded.push({ kind: "no-match", glob: item.entry });
    for (const path of paths) expanded.push({ kind: "match", glob: item.entry, path });
  }
  return expanded;
}
