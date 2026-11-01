import { lstat } from "node:fs/promises";
import {
  decodeTestSourceText,
  isUnsafeTestSourcePath,
  type PolicyFileBase,
  parsePolicyJson,
  type ResolvedPolicy,
} from "@pharn-ci/core";
import { batchCheck, batchRead, type GitBatchDeps } from "./gitBlobs.js";

/** The largest policy file read, in bytes, judged by its size on disk before it is read. */
export const POLICY_FILE_MAX_BYTES = 1_048_576;

/** What `lstatPath` says about a path, without following a symbolic link. */
export interface PathStat {
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
}

/** `lstat` of a path: null when it or a directory above it does not exist. A symbolic link is reported, never followed. */
export async function lstatPath(path: string): Promise<PathStat | null> {
  try {
    const stat = await lstat(path);
    const kind = stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "directory"
        : stat.isFile()
          ? "file"
          : "other";
    return { kind, size: stat.size };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

/** What `readPolicyFile` reads through; the adapters pass their own file reads and path resolution. */
export interface PolicyFileDeps {
  readFile(path: string): Promise<string | null>;
  resolvePath(...segments: string[]): string;
  lstat(path: string): Promise<PathStat | null>;
}

/**
 * A policy file that cannot be used. The message is fixed per case and never holds the path, the directory it
 * resolved to or anything from the file; an invalid document lists its problems as `pointer: message` lines.
 */
export class PolicyFileError extends Error {
  override name = "PolicyFileError";
}

/** The most problem lines an invalid document lists (`validatePolicy` already caps its list at this). */
const MAX_LISTED_PROBLEMS = 50;

/**
 * Reads the org policy document a pull request carries (`policy: file:<path>` in the Action, `--policy-file` in the
 * CLI) from `path`, relative to `root`. The path must be non-empty, relative, and stay inside `root` once `.` and `..`
 * segments are resolved; no segment below `root` may be a symbolic link (each prefix is `lstat`ed, never followed), and
 * the last one must be a regular file of at most 1,048,576 bytes. The text must be a valid policy document
 * (`parsePolicyJson`). `label` names the setting in the errors: `the policy input` or `--policy-file`. The result is
 * a `ResolvedPolicy` of source `file`; it is untrusted input, carried by the pull request.
 */
export async function readPolicyFile(
  deps: PolicyFileDeps,
  options: { root: string; path: string; label: string },
): Promise<ResolvedPolicy> {
  const { label } = options;
  const fail = (reason: string): PolicyFileError => new PolicyFileError(`${label} ${reason}`);
  const raw = options.path;
  if (raw.trim() === "") throw fail("is empty: name a policy file relative to the repository");
  if (raw.startsWith("/") || raw.startsWith("\\") || /^[A-Za-z]:/.test(raw)) {
    throw fail("must be a path relative to the repository, not an absolute path");
  }
  const segments: string[] = [];
  for (const segment of raw.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) throw fail("must stay inside the repository");
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) throw fail("does not name a file");

  // Every prefix below the root is looked at without following links: a link, or a missing entry, refuses.
  let size = 0;
  for (let depth = 1; depth <= segments.length; depth++) {
    const stat = await deps.lstat(deps.resolvePath(options.root, ...segments.slice(0, depth)));
    if (stat === null) throw fail("names a file that does not exist");
    if (stat.kind === "symlink") throw fail("must not go through a symbolic link");
    if (depth < segments.length) {
      if (stat.kind !== "directory") throw fail("names a file that does not exist");
    } else {
      if (stat.kind !== "file") throw fail("must name a regular file");
      size = stat.size;
    }
  }
  if (size > POLICY_FILE_MAX_BYTES) throw fail("names a file that is too large (the limit is 1 MiB)");

  const text = await deps.readFile(deps.resolvePath(options.root, ...segments));
  if (text === null) throw fail("names a file that does not exist");
  const parsed = parsePolicyJson(text);
  if (!parsed.ok) {
    const lines = parsed.errors
      .slice(0, MAX_LISTED_PROBLEMS)
      .map((error) => `${error.path === "" ? "(document)" : error.path}: ${error.message}`);
    throw fail(`is not a valid policy document:\n${lines.join("\n")}`);
  }
  return { source: "file", version: null, path: segments.join("/"), document: parsed.policy };
}

/** A revision that may be given to git as `<rev>:<path>`: non-empty, no leading `-`, no `:`, whitespace or control character. */
function isUsableRevision(rev: string): boolean {
  if (rev === "" || rev.startsWith("-")) return false;
  for (let i = 0; i < rev.length; i++) {
    const code = rev.charCodeAt(i);
    if (code <= 0x20 || (code >= 0x7f && code <= 0xa0) || code === 0x3a) return false;
  }
  return true;
}

/**
 * The `file:` policy as it is at a git revision (the merge base of the pull request), read from committed objects only:
 * never the working tree, and no symbolic link is followed (`cat-file` without `--follow-symlinks` gives a link's blob,
 * which holds the target's name and fails to parse). One `cat-file --batch-check` asks for the revision's root tree and
 * for the path; a missing root tree means the revision does not exist. A missing path is `absent`. Anything else that is
 * not a blob of at most 1 MiB holding a valid policy document (`parsePolicyJson`) is `unreadable`. A path with a control
 * character or a `.` or `..` segment, and a revision git could read as an option or a range, never reach git. This
 * never rejects and never returns error text.
 */
export async function readPolicyFileAt(
  deps: GitBatchDeps,
  options: { rev: string; path: string },
): Promise<PolicyFileBase> {
  const unreadable: PolicyFileBase = { kind: "unreadable" };
  try {
    const { rev, path } = options;
    if (typeof rev !== "string" || typeof path !== "string") return unreadable;
    if (isUnsafeTestSourcePath(path) || !isUsableRevision(rev)) return unreadable;
    const [root, object] = await batchCheck(deps, [
      { oid: rev, path: "" },
      { oid: rev, path },
    ]);
    if (root === null || root === undefined) return unreadable;
    if (object === null || object === undefined) return { kind: "absent" };
    if (object.object.type !== "blob" || object.object.size > POLICY_FILE_MAX_BYTES) return unreadable;
    const contents = await batchRead(deps, [object.oid]);
    const bytes = contents.get(object.oid);
    if (bytes === undefined) return unreadable;
    const text = decodeTestSourceText(bytes);
    if (text === null) return unreadable;
    const parsed = parsePolicyJson(text);
    return parsed.ok ? { kind: "document", document: parsed.policy } : unreadable;
  } catch {
    return unreadable;
  }
}
