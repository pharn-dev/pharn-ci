import type { DiffFile } from "../diff/unified.js";
import { byCodeUnit } from "../text.js";
import type { DependencyEcosystem } from "./types.js";

/** What a manifest or lockfile path is, by name only. */
export type DependencyFileKind =
  | { ecosystem: "npm"; role: "manifest"; format: "package-json" }
  | { ecosystem: "npm"; role: "lock"; format: "package-lock" | "pnpm" | "yarn" }
  | { ecosystem: "pypi"; role: "manifest"; format: "requirements" | "pyproject" }
  | { ecosystem: "pypi"; role: "lock"; format: "poetry" | "uv" };

/** The npm lockfile names, in the order a directory's lockfile is looked for. */
export const NPM_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"] as const;
/** The Python lockfile names read next to a pyproject.toml. */
export const PYTHON_LOCKFILES = ["poetry.lock", "uv.lock"] as const;

/** The directory of a repo-relative path, `""` for the root. */
export function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

const joinPath = (dir: string, name: string) => (dir === "" ? name : `${dir}/${name}`);

/**
 * The kind of a manifest or lockfile, by basename at any depth, case-sensitive; never under a `node_modules` directory.
 * npm: `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`. Python:
 * `pyproject.toml`, `poetry.lock`, `uv.lock`, and a requirements file: a `.txt` basename that starts with
 * `requirements`, or any `.txt` file in a directory named `requirements`.
 */
export function classifyDependencyFile(path: string): DependencyFileKind | null {
  const segments = path.split("/");
  if (segments.includes("node_modules")) return null;
  const base = segments[segments.length - 1] as string;
  switch (base) {
    case "package.json":
      return { ecosystem: "npm", role: "manifest", format: "package-json" };
    case "package-lock.json":
    case "npm-shrinkwrap.json":
      return { ecosystem: "npm", role: "lock", format: "package-lock" };
    case "pnpm-lock.yaml":
      return { ecosystem: "npm", role: "lock", format: "pnpm" };
    case "yarn.lock":
      return { ecosystem: "npm", role: "lock", format: "yarn" };
    case "pyproject.toml":
      return { ecosystem: "pypi", role: "manifest", format: "pyproject" };
    case "poetry.lock":
      return { ecosystem: "pypi", role: "lock", format: "poetry" };
    case "uv.lock":
      return { ecosystem: "pypi", role: "lock", format: "uv" };
    default:
      break;
  }
  const parent = segments.length >= 2 ? segments[segments.length - 2] : undefined;
  if (base.endsWith(".txt") && (base.startsWith("requirements") || parent === "requirements")) {
    return { ecosystem: "pypi", role: "manifest", format: "requirements" };
  }
  return null;
}

/**
 * The tracked lockfiles that may govern a manifest, nearest directory first: for package.json, the lockfiles of the
 * nearest directory (its own or an ancestor) that has one; for pyproject.toml, the poetry.lock and uv.lock beside it; a
 * requirements file has none.
 */
export function candidateLockfiles(
  manifest: string,
  ecosystem: DependencyEcosystem,
  format: string,
  tracked: ReadonlySet<string>,
): string[] {
  if (ecosystem === "pypi") {
    if (format !== "pyproject") return [];
    return PYTHON_LOCKFILES.map((name) => joinPath(dirOf(manifest), name)).filter((path) => tracked.has(path));
  }
  let dir: string | null = dirOf(manifest);
  while (dir !== null) {
    const here = NPM_LOCKFILES.map((name) => joinPath(dir as string, name)).filter((path) => tracked.has(path));
    if (here.length > 0) return here;
    dir = dir === "" ? null : dirOf(dir);
  }
  return [];
}

/** Every path a diff touches, as a new or an old path. */
export function touchedPaths(diff: readonly DiffFile[]): Set<string> {
  const touched = new Set<string>();
  for (const file of diff) {
    touched.add(file.path);
    touched.add(file.oldPath);
  }
  return touched;
}

/**
 * The manifest and lockfile paths read on each side. The base side gets the old path of a modified, deleted or renamed
 * manifest or lockfile; the head side the path of an added, modified or renamed one, and the lockfiles in an ancestor
 * directory of a changed package.json (to see whether that lockfile governs it). Each side is de-duplicated and sorted.
 */
export function selectDependencyPaths(
  diff: readonly DiffFile[],
  repoFiles: readonly string[],
): { base: string[]; head: string[] } {
  const base = new Set<string>();
  const head = new Set<string>();
  const tracked = new Set(repoFiles);
  for (const file of diff) {
    if (
      (file.status === "modified" || file.status === "deleted" || file.status === "renamed") &&
      classifyDependencyFile(file.oldPath) !== null
    ) {
      base.add(file.oldPath);
    }
    if (file.status === "added" || file.status === "modified" || file.status === "renamed") {
      const kind = classifyDependencyFile(file.path);
      if (kind === null) continue;
      head.add(file.path);
      if (kind.role === "manifest" && kind.ecosystem === "npm") {
        for (const lock of candidateLockfiles(file.path, "npm", kind.format, tracked)) {
          if (dirOf(lock) !== dirOf(file.path)) head.add(lock);
        }
      }
    }
  }
  return { base: [...base].sort(byCodeUnit), head: [...head].sort(byCodeUnit) };
}
