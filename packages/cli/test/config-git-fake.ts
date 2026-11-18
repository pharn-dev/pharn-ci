import { createHash } from "node:crypto";

// A fake git for the CORE-95 tests: it answers `rev-parse --verify`, `merge-base` and the `cat-file --batch-check` /
// `cat-file --batch` calls the merge-base config reader makes, from an in-memory tree of the files at the merge base.
// Every other git call goes to `fallback`. Object ids are sha1 hex of the content, as long as git's.

export const BASE_OID = "1".repeat(40);
export const HEAD_OID = "2".repeat(40);
export const MERGE_BASE_OID = "3".repeat(40);

/** A file at the merge base: its text, or a symbolic link with the target it names. */
export type BaseEntry = string | { symlink: string };

export interface FakeBaseOptions {
  /** The files at the merge base, by repo-relative path. */
  files: Record<string, BaseEntry>;
  /** Makes `git merge-base` fail, as with no common history or a shallow clone. */
  noMergeBase?: boolean;
}

interface FakeObject {
  type: "blob" | "tree";
  bytes: Buffer;
}

const oidOf = (type: string, bytes: Buffer) => createHash("sha1").update(`${type}\0`).update(bytes).digest("hex");

/** The objects of the tree the files make, and the object id each `<path>` (and `""` for the root) resolves to. */
function buildTree(files: Record<string, BaseEntry>) {
  const objects = new Map<string, FakeObject>();
  const paths = new Map<string, string>();
  type Dir = Map<string, { mode: string; oid: string } | Dir>;
  const root: Dir = new Map();
  for (const [path, entry] of Object.entries(files)) {
    const segments = path.split("/");
    let dir = root;
    for (const segment of segments.slice(0, -1)) {
      let next = dir.get(segment);
      if (next === undefined || !(next instanceof Map)) {
        next = new Map();
        dir.set(segment, next);
      }
      dir = next;
    }
    const bytes = Buffer.from(typeof entry === "string" ? entry : entry.symlink, "utf8");
    const oid = oidOf("blob", bytes);
    objects.set(oid, { type: "blob", bytes });
    paths.set(path, oid);
    dir.set(segments.at(-1) as string, { mode: typeof entry === "string" ? "100644" : "120000", oid });
  }
  const write = (dir: Dir, prefix: string): string => {
    const parts: Buffer[] = [];
    for (const name of [...dir.keys()].sort()) {
      const value = dir.get(name) as { mode: string; oid: string } | Dir;
      const full = prefix === "" ? name : `${prefix}/${name}`;
      const { mode, oid } = value instanceof Map ? { mode: "40000", oid: write(value, full) } : value;
      parts.push(Buffer.from(`${mode} ${name}\0`, "utf8"), Buffer.from(oid, "hex"));
    }
    const bytes = Buffer.concat(parts);
    const oid = oidOf("tree", bytes);
    objects.set(oid, { type: "tree", bytes });
    paths.set(prefix, oid);
    return oid;
  };
  write(root, "");
  return { objects, paths };
}

/**
 * `git` and `gitBatch` doubles over the files at the merge base. `git` answers `rev-parse --verify` (HEAD_OID for
 * `HEAD^{commit}`, BASE_OID for any other revision) and `merge-base` (MERGE_BASE_OID, or a failure); everything else
 * goes to `fallback`. `gitBatch` answers `<MERGE_BASE_OID>:<path>` lookups and object reads; anything else is missing.
 */
export function fakeConfigGit(options: FakeBaseOptions, fallback: (args: string[]) => Promise<string>) {
  const { objects, paths } = buildTree(options.files);
  const batchInputs: string[] = [];
  const git = async (args: string[]): Promise<string> => {
    if (args[0] === "rev-parse" && args.includes("--verify")) {
      return `${args.at(-1) === "HEAD^{commit}" ? HEAD_OID : BASE_OID}\n`;
    }
    if (args[0] === "merge-base") {
      if (options.noMergeBase === true) throw new Error("fatal: no merge base");
      return `${MERGE_BASE_OID}\n`;
    }
    return fallback(args);
  };
  const gitBatch = async (args: string[], input: string): Promise<Uint8Array> => {
    batchInputs.push(input);
    const lines = input.split("\n").slice(0, -1);
    if (args.join(" ") === "cat-file --batch-check") {
      const out = lines.map((line) => {
        const at = line.indexOf(":");
        const oid = at !== -1 && line.slice(0, at) === MERGE_BASE_OID ? paths.get(line.slice(at + 1)) : undefined;
        const object = oid === undefined ? undefined : objects.get(oid);
        return object === undefined ? `${line} missing\n` : `${oid} ${object.type} ${object.bytes.length}\n`;
      });
      return Buffer.from(out.join(""), "utf8");
    }
    if (args.join(" ") === "cat-file --batch") {
      const parts = lines.map((oid) => {
        const object = objects.get(oid);
        if (object === undefined) return Buffer.from(`${oid} missing\n`, "utf8");
        return Buffer.concat([
          Buffer.from(`${oid} ${object.type} ${object.bytes.length}\n`, "utf8"),
          object.bytes,
          Buffer.from("\n", "utf8"),
        ]);
      });
      return Buffer.concat(parts);
    }
    throw new Error(`unexpected git batch call ${args.join(" ")}`);
  };
  return { git, gitBatch, batchInputs };
}
