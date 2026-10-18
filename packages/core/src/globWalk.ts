import { compileGlob } from "./glob.js";

/**
 * A bounded walk that finds the files a glob matches, over a directory listing the caller supplies.
 * Pure: the listing function does all the reading, so this module never touches a file system.
 *
 * - A symbolic link (or anything that is neither a file nor a directory) is never read and never entered.
 * - A directory named `.git` or `node_modules` is entered only where the pattern names it literally, before
 *   any `**` segment.
 * - The walk starts at the base and goes down only along the pattern's literal directory prefix and, once a
 *   `**` segment is reached, through every directory below it. Each listed entry is looked at once, so the
 *   work is linear in the entries visited for a given pattern.
 * - The number of listed entries and of matched files is counted in a budget the caller shares across the
 *   globs of one run; going over a limit throws a WalkLimitError.
 */

/** One entry of a directory listing. */
export interface DirEntry {
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
}

/**
 * Lists a directory given as a path relative to the base (`""` for the base itself, then `a`, `a/b`), with
 * `/` as the separator. Resolves null when the directory does not exist or is not a directory.
 */
export type ListDir = (dir: string) => Promise<readonly DirEntry[] | null>;

/** How much of the limits has been used so far. */
export interface WalkBudget {
  files: number;
  entries: number;
}

export class WalkLimitError extends Error {
  override name = "WalkLimitError";
  constructor(readonly limit: "files" | "entries") {
    super(`the glob walk exceeded its ${limit} limit`);
  }
}

/** The repo-relative paths (forward slashes, sorted in code-unit order) of the files `pattern` matches. */
export async function walkGlob(
  pattern: string,
  listDir: ListDir,
  budget: WalkBudget,
  limits: { files: number; entries: number },
): Promise<string[]> {
  const segments = pattern.split("/");
  const globstar = segments.indexOf("**");
  const matchers = segments.map((segment) => (segment === "**" ? null : compileGlob(segment)));
  const full = compileGlob(pattern);
  const last = segments.length - 1;
  const found: string[] = [];

  // Directories still to list, as base-relative paths; "" is the base itself (depth 0).
  const pending: Array<{ dir: string; depth: number }> = [{ dir: "", depth: 0 }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { dir, depth } = item;
    const entries = await listDir(dir);
    if (entries === null) continue;
    budget.entries += entries.length;
    if (budget.entries > limits.entries) throw new WalkLimitError("entries");

    const beforeGlobstar = globstar === -1 || depth < globstar;
    for (const entry of entries) {
      if (entry.kind === "symlink" || entry.kind === "other") continue;
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.kind === "file") {
        if (!full(path)) continue;
        budget.files++;
        if (budget.files > limits.files) throw new WalkLimitError("files");
        found.push(path);
        continue;
      }
      // A directory.
      if (entry.name === ".git" || entry.name === "node_modules") {
        if (beforeGlobstar && depth < last && segments[depth] === entry.name)
          pending.push({ dir: path, depth: depth + 1 });
        continue;
      }
      if (!beforeGlobstar) {
        pending.push({ dir: path, depth: depth + 1 });
      } else if (depth < last && (matchers[depth] as (path: string) => boolean)(entry.name)) {
        pending.push({ dir: path, depth: depth + 1 });
      }
    }
  }
  return found.sort();
}
