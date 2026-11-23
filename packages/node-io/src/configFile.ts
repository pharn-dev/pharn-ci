import {
  ConfigError,
  type ConfigSource,
  configDiffState,
  configRepoPath,
  type DiffFile,
  decodeTestSourceText,
  isUnsafeTestSourcePath,
  type PharnConfig,
  parseConfig,
} from "@pharn-ci/core";
import { batchCheck, batchRead, type GitBatchDeps } from "./gitBlobs.js";
import { isUsableRevision } from "./policyFile.js";
import type { RunRevisions } from "./revisions.js";

/** The largest pharn-ci config read from git objects, in bytes, judged by the blob's size before it is read. */
export const CONFIG_FILE_MAX_BYTES = 1_048_576;

/** The git call the reader makes: bytes out for a call given stdin. */
export type ConfigFileGitDeps = GitBatchDeps;

/**
 * The pharn-ci config as it is at the merge base: its text, `absent` when no entry has that path there, or
 * `unreadable` when it could not be read as a regular file of UTF-8 text.
 */
export type ConfigFileBase = { kind: "text"; text: string } | { kind: "absent" } | { kind: "unreadable" };

/** The tree entry modes of a regular file (`100644`, `100755`); a symbolic link is `120000`. */
const REGULAR_FILE_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);

/** The mode and object id of the entry named `name` in a git tree object's bytes, or null when it has none. */
function treeEntry(tree: Uint8Array, name: string, oidBytes: number): { mode: string; oid: string } | null {
  let at = 0;
  while (at < tree.length) {
    const space = tree.indexOf(0x20, at);
    const nul = space === -1 ? -1 : tree.indexOf(0x00, space + 1);
    if (space === -1 || nul === -1 || nul + 1 + oidBytes > tree.length) return null;
    const mode = Buffer.from(tree.subarray(at, space)).toString("latin1");
    const entryName = Buffer.from(tree.subarray(space + 1, nul)).toString("utf8");
    const oid = Buffer.from(tree.subarray(nul + 1, nul + 1 + oidBytes)).toString("hex");
    if (entryName === name) return { mode, oid };
    at = nul + 1 + oidBytes;
  }
  return null;
}

/**
 * The pharn-ci config at `path` as it is at the merge base of the run's base and HEAD, read from committed objects only,
 * never the working tree (CORE-95). The run's revisions find the commit (see `RunRevisions`); one
 * `cat-file --batch-check` asks for the merge base's tree, the directory that holds the file and the file itself; one
 * `cat-file --batch` reads that directory's tree, so the entry's mode is known; one more reads the blob. No symbolic link
 * is followed: a link at the path, or on the way to it, is `unreadable` or `absent`, never its target. A path git has no
 * entry for is `absent`. Anything else that is not a regular file of at most 1 MiB holding UTF-8 text is `unreadable`, as
 * is a merge base that cannot be found (no common history, a shallow clone) or any git failure. A path with a control
 * character or a `.` or `..` segment, and a revision git could read as an option or a range, never reach git. This never
 * rejects and never returns error text; the text is not parsed here.
 */
export async function readConfigFileAt(
  deps: ConfigFileGitDeps,
  options: { revisions: RunRevisions; path: string },
): Promise<ConfigFileBase> {
  const unreadable: ConfigFileBase = { kind: "unreadable" };
  try {
    const { revisions, path } = options;
    if (isUnsafeTestSourcePath(path) || !isUsableRevision(revisions.base)) return unreadable;
    const resolved = await revisions.resolve();
    if ("unresolved" in resolved) return unreadable;
    const { mergeBase } = resolved;

    const slash = path.lastIndexOf("/");
    const dir = slash === -1 ? "" : path.slice(0, slash);
    const name = path.slice(slash + 1);
    const [root, folder, object] = await batchCheck(deps, [
      { oid: mergeBase, path: "" },
      { oid: mergeBase, path: dir },
      { oid: mergeBase, path },
    ]);
    if (root === null || root === undefined || root.object.type !== "tree") return unreadable;
    // A directory on the way that is missing, or is a link or a file, holds no entry for the path.
    if (folder === null || folder === undefined || folder.object.type !== "tree") return { kind: "absent" };
    if (object === null || object === undefined) return { kind: "absent" };
    if (object.object.type !== "blob" || object.object.size > CONFIG_FILE_MAX_BYTES) return unreadable;

    const trees = await batchRead(deps, [folder.oid], "tree");
    const tree = trees.get(folder.oid);
    if (tree === undefined) return unreadable;
    const entry = treeEntry(tree, name, folder.oid.length / 2);
    // The tree's own entry decides: a symbolic link (120000) is never read as the file it names.
    if (entry === null || !REGULAR_FILE_MODES.has(entry.mode) || entry.oid !== object.oid) return unreadable;

    const contents = await batchRead(deps, [object.oid]);
    const bytes = contents.get(object.oid);
    if (bytes === undefined) return unreadable;
    const text = decodeTestSourceText(bytes);
    return text === null ? unreadable : { kind: "text", text };
  } catch {
    return unreadable;
  }
}

/**
 * Which copy of the pharn-ci config in use a check runs with (CORE-95): the working tree's, the text of its copy at the
 * merge base (with its repo path, for error messages), none because the change adds it (`absent`), or none because the
 * copy at the merge base could not be read (`unreadable`).
 */
export type ConfigCopy =
  | { source: "working-tree" }
  | { source: "merge-base"; path: string; text: string }
  | { source: "absent" }
  | { source: "unreadable" };

/**
 * The copy of the config in use a check runs with, decided by the change's diff (CORE-95), the same way for the CLI
 * and the Action. No diff (`null`): the working tree. A change that does not touch the config: the working tree. One
 * that adds it (or renames a file to it): `absent`, so the defaults and the inputs apply. One that modifies or deletes
 * it (or renames it away): its copy at the merge base of the run's base and HEAD, read from git objects by
 * `readConfigFileAt`; with no `revisions`, or a copy that cannot be read or is not there, `unreadable`. The text is not parsed
 * here: a copy that does not parse fails the run where the caller parses it.
 */
export async function configCopyInUse(
  deps: ConfigFileGitDeps,
  options: {
    diff: readonly DiffFile[] | null;
    revisions: RunRevisions | undefined;
    configPath: string | undefined;
    repoRoot: string;
  },
): Promise<ConfigCopy> {
  if (options.diff === null) return { source: "working-tree" };
  const state = configDiffState(options.diff, options.configPath, options.repoRoot);
  if (state === "untouched") return { source: "working-tree" };
  if (state === "added") return { source: "absent" };
  const path = configRepoPath(options.configPath, options.repoRoot);
  if (path === null || options.revisions === undefined) return { source: "unreadable" };
  const copy = await readConfigFileAt(deps, { revisions: options.revisions, path });
  return copy.kind === "text" ? { source: "merge-base", path, text: copy.text } : { source: "unreadable" };
}

/** Where the config in use is and how errors name it; the same for the CLI and the Action. */
export interface ConfigFileLocation {
  /** The absolute path of the config file. */
  path: string;
  /** How an error names the file (the CLI: the absolute path; the Action: the path as the input or the default writes it). */
  name: string;
  /** Named by a flag or an input: a missing file is then an error, so a typo cannot drop a threshold held only there. */
  explicit: boolean;
}

/** The config a check runs with, which copy it is when not the working tree's, and that copy's exclusions for TI14. */
export interface ConfigInUse {
  config: PharnConfig;
  configSource?: ConfigSource;
  headConfigExclude?: string[];
}

/**
 * The working tree's config: a missing default file is no config; a missing file a flag or an input names, or one that
 * does not parse, is a `ConfigError`.
 */
export async function loadConfig(
  deps: { readFile(path: string): Promise<string | null> },
  location: ConfigFileLocation,
): Promise<PharnConfig> {
  const text = await deps.readFile(location.path);
  if (text === null) {
    if (location.explicit) throw new ConfigError(`config file not found: ${location.name}`);
    return {};
  }
  try {
    return parseConfig(text);
  } catch (err) {
    throw new ConfigError(`${location.name}: ${errorText(err)}`);
  }
}

/**
 * The config the check runs with, and which copy it is (CORE-95), the same for the CLI and the Action: a change that
 * edits the config in use is checked with its copy at the merge base (`configCopyInUse`), one that adds it with none;
 * with no diff, or a diff that leaves it alone, the working tree's copy is read as `loadConfig` reads it. A copy at the
 * merge base that cannot be read runs with none, and core says so; one that does not parse is a `ConfigError`. When the
 * check does not run with the working tree's copy, that copy's exclusions are kept for TI14 alone (`headConfigExclude`);
 * a copy that does not parse gives none.
 */
export async function loadConfigInUse(
  deps: ConfigFileGitDeps & { readFile(path: string): Promise<string | null> },
  location: ConfigFileLocation & {
    /** The config path as check() is given it (`CheckInput.configPath`); undefined for the default file. */
    configPath: string | undefined;
    repoRoot: string;
    diff: readonly DiffFile[] | null;
    revisions: RunRevisions | undefined;
  },
): Promise<ConfigInUse> {
  const copy = await configCopyInUse(deps, {
    diff: location.diff,
    revisions: location.revisions,
    configPath: location.configPath,
    repoRoot: location.repoRoot,
  });
  if (copy.source === "working-tree") return { config: await loadConfig(deps, location) };
  const headConfigExclude = headExclusions(await deps.readFile(location.path));
  const head = headConfigExclude === undefined ? {} : { headConfigExclude };
  if (copy.source !== "merge-base") return { config: {}, configSource: copy.source, ...head };
  try {
    return { config: parseConfig(copy.text), configSource: "merge-base", ...head };
  } catch (err) {
    throw new ConfigError(`${copy.path} at the merge base: ${errorText(err)}`);
  }
}

/** The `coverage.exclude` patterns of a config's text, or undefined when there is no text or it does not parse. */
function headExclusions(text: string | null): string[] | undefined {
  if (text === null) return undefined;
  try {
    return parseConfig(text).coverage?.exclude;
  } catch {
    return undefined;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
