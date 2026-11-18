import {
  configDiffState,
  configRepoPath,
  type DiffFile,
  decodeTestSourceText,
  isUnsafeTestSourcePath,
} from "@pharn-ci/core";
import { batchCheck, batchRead, type GitBatchDeps, OBJECT_ID } from "./gitBlobs.js";
import { isUsableRevision } from "./policyFile.js";

/** The largest pharn-ci config read from git objects, in bytes, judged by the blob's size before it is read. */
export const CONFIG_FILE_MAX_BYTES = 1_048_576;

/** The git calls the reader makes: whole text out (`rev-parse`, `merge-base`), and bytes out for a call given stdin. */
export interface ConfigFileGitDeps extends GitBatchDeps {
  git(args: string[]): Promise<string>;
}

/**
 * The pharn-ci config as it is at the merge base: its text, `absent` when no entry has that path there, or
 * `unreadable` when it could not be read as a regular file of UTF-8 text.
 */
export type ConfigFileBase = { kind: "text"; text: string } | { kind: "absent" } | { kind: "unreadable" };

/** The tree entry modes of a regular file (`100644`, `100755`); a symbolic link is `120000`. */
const REGULAR_FILE_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);

/** The commit id `revision` names, or null. */
async function commitOf(deps: ConfigFileGitDeps, revision: string): Promise<string | null> {
  const out = await deps.git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`]);
  const oid = out.trim();
  return OBJECT_ID.test(oid) ? oid : null;
}

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
 * The pharn-ci config at `path` as it is at the merge base of `base` and `head` (default `HEAD`), read from committed
 * objects only, never the working tree (CORE-95). One `rev-parse` per revision and one `merge-base` find the commit; one
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
  options: { base: string; head?: string; path: string },
): Promise<ConfigFileBase> {
  const unreadable: ConfigFileBase = { kind: "unreadable" };
  try {
    const { base, path } = options;
    const head = options.head ?? "HEAD";
    if (isUnsafeTestSourcePath(path) || !isUsableRevision(base) || !isUsableRevision(head)) return unreadable;
    const baseOid = await commitOf(deps, base);
    const headOid = await commitOf(deps, head);
    if (baseOid === null || headOid === null) return unreadable;
    const mergeBase = (await deps.git(["merge-base", baseOid, headOid])).trim();
    if (!OBJECT_ID.test(mergeBase)) return unreadable;

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
 * it (or renames it away): its copy at the merge base of `base` and HEAD, read from git objects by `readConfigFileAt`;
 * with no `base`, no `gitBatch`, or a copy that cannot be read or is not there, `unreadable`. The text is not parsed
 * here: a copy that does not parse fails the run where the caller parses it.
 */
export async function configCopyInUse(
  deps: { git(args: string[]): Promise<string>; gitBatch?: GitBatchDeps["gitBatch"] | undefined },
  options: {
    diff: readonly DiffFile[] | null;
    base: string | undefined;
    configPath: string | undefined;
    repoRoot: string;
  },
): Promise<ConfigCopy> {
  if (options.diff === null) return { source: "working-tree" };
  const state = configDiffState(options.diff, options.configPath, options.repoRoot);
  if (state === "untouched") return { source: "working-tree" };
  if (state === "added") return { source: "absent" };
  const path = configRepoPath(options.configPath, options.repoRoot);
  const { gitBatch } = deps;
  if (path === null || options.base === undefined || gitBatch === undefined) return { source: "unreadable" };
  const copy = await readConfigFileAt({ git: (args) => deps.git(args), gitBatch }, { base: options.base, path });
  return copy.kind === "text" ? { source: "merge-base", path, text: copy.text } : { source: "unreadable" };
}
