import type { DiffFile } from "./diff/unified.js";
import { isTestFile } from "./testFiles.js";

/** Why a selected test or test-config file has no text in the sources. */
export type TestSourceDropReason =
  | "too-large"
  | "over-file-cap"
  | "over-total-cap"
  | "binary"
  | "missing"
  | "unsafe-path";

/** The drop reasons, in the order the read plan tries them. */
export const TEST_SOURCE_DROP_REASONS: readonly TestSourceDropReason[] = [
  "too-large",
  "over-file-cap",
  "over-total-cap",
  "binary",
  "missing",
  "unsafe-path",
];

/** The text of one test or test-config file at one revision. */
export interface TestSourceFile {
  path: string;
  text: string;
}

/** A selected file whose text was not kept, and why. */
export interface TestSourceDrop {
  path: string;
  reason: TestSourceDropReason;
}

/** One side (base or head) of the test sources: why it could not be read, or the files kept and the files dropped. */
export type TestSourceSide = { unavailable: string } | { files: TestSourceFile[]; dropped: TestSourceDrop[] };

/**
 * The text of the test and test-config files a change touches, at the merge base and at HEAD. `files` and `dropped`
 * are each sorted by path in code-unit order, and a path is in exactly one of them.
 */
export interface TestSources {
  base: TestSourceSide;
  head: TestSourceSide;
}

/** At most this many files are read per side. */
export const MAX_TEST_SOURCE_FILES = 200;
/** A file larger than this many bytes is not read. */
export const MAX_TEST_SOURCE_FILE_BYTES = 524288;
/** At most this many bytes are read per side, counting the files that turn out to be binary. */
export const MAX_TEST_SOURCE_TOTAL_BYTES = 16777216;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const TEST_CONFIG_PREFIXES: readonly string[] = [
  "vitest.config.",
  "vitest.workspace.",
  "jest.config.",
  "playwright.config.",
];
const TEST_CONFIG_NAMES: ReadonlySet<string> = new Set([
  "pytest.ini",
  "pyproject.toml",
  "setup.cfg",
  "tox.ini",
  "conftest.py",
  "package.json",
]);

/**
 * Whether a path is a test-config file, by basename at any depth, case-sensitive: a basename that starts with
 * `vitest.config.`, `vitest.workspace.`, `jest.config.` or `playwright.config.` and has at least one more character,
 * or starts with `.mocharc`, or is exactly `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini`, `conftest.py` or
 * `package.json`. By name only: it reads no file.
 */
export function isTestConfigFile(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (TEST_CONFIG_NAMES.has(basename)) return true;
  if (basename.startsWith(".mocharc")) return true;
  return TEST_CONFIG_PREFIXES.some((prefix) => basename.length > prefix.length && basename.startsWith(prefix));
}

const isTestSource = (path: string) => isTestFile(path) || isTestConfigFile(path);

/**
 * The paths whose text is read on each side. The base side gets the old path of a modified, deleted or renamed entry,
 * the head side the path of an added, modified or renamed entry, each only when that path itself is a test file or a
 * test-config file. Each side is de-duplicated and sorted in code-unit order, so the entry order never matters.
 */
export function selectTestSourcePaths(diff: readonly DiffFile[]): { base: string[]; head: string[] } {
  const base = new Set<string>();
  const head = new Set<string>();
  for (const file of diff) {
    if (
      (file.status === "modified" || file.status === "deleted" || file.status === "renamed") &&
      isTestSource(file.oldPath)
    ) {
      base.add(file.oldPath);
    }
    if (
      (file.status === "added" || file.status === "modified" || file.status === "renamed") &&
      isTestSource(file.path)
    ) {
      head.add(file.path);
    }
  }
  return { base: [...base].sort(byCodeUnit), head: [...head].sort(byCodeUnit) };
}

/**
 * Whether a path must never be written to git's stdin as `<oid>:<path>`: it has a control character (U+0000 to
 * U+001F, U+007F, U+0080 to U+009F), is empty, starts with `/`, or has an empty, `.` or `..` segment. A real git diff
 * names no such path except through a control character; the segment rule keeps `<oid>:./x` and `<oid>:../x`, which git
 * resolves against the working directory, from reaching a blob the name does not say.
 */
export function isUnsafeTestSourcePath(path: string): boolean {
  if (path === "" || path.startsWith("/")) return true;
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/** The type and size in bytes of a git object, as `git cat-file --batch-check` reports them. */
export interface TestSourceObject {
  type: string;
  size: number;
}

/**
 * Decides from object types and sizes alone which files are read. `objects` maps each safe path to its object, or to
 * null when it is absent at that revision. Paths are taken in code-unit order and each gets the first outcome that
 * applies: `unsafe-path`; `missing` (no entry, null, or not a blob); `too-large`; `over-file-cap` once
 * `MAX_TEST_SOURCE_FILES` files are planned; `over-total-cap` when the running total is tripped or this file would
 * take it past `MAX_TEST_SOURCE_TOTAL_BYTES`, which trips it for every later path. Otherwise the file is read and its
 * size is added to the total. `read` and `dropped` are each in path order.
 */
export function planTestSourceReads(
  paths: readonly string[],
  objects: ReadonlyMap<string, TestSourceObject | null>,
): { read: string[]; dropped: TestSourceDrop[] } {
  const read: string[] = [];
  const dropped: TestSourceDrop[] = [];
  let total = 0;
  let tripped = false;
  for (const path of [...new Set(paths)].sort(byCodeUnit)) {
    if (isUnsafeTestSourcePath(path)) {
      dropped.push({ path, reason: "unsafe-path" });
      continue;
    }
    const object = objects.get(path);
    if (object === undefined || object === null || object.type !== "blob") {
      dropped.push({ path, reason: "missing" });
    } else if (object.size > MAX_TEST_SOURCE_FILE_BYTES) {
      dropped.push({ path, reason: "too-large" });
    } else if (read.length >= MAX_TEST_SOURCE_FILES) {
      dropped.push({ path, reason: "over-file-cap" });
    } else if (tripped || total + object.size > MAX_TEST_SOURCE_TOTAL_BYTES) {
      tripped = true;
      dropped.push({ path, reason: "over-total-cap" });
    } else {
      total += object.size;
      read.push(path);
    }
  }
  return { read, dropped };
}

/** Both sides unavailable for one reason. */
export function unavailableTestSources(reason: string): TestSources {
  return { base: { unavailable: reason }, head: { unavailable: reason } };
}
