import type { DiffFile } from "./diff/unified.js";

const TEST_DIRECTORIES: ReadonlySet<string> = new Set(["test", "tests", "__tests__"]);

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Basename patterns of the test-integrity spec's test globs. Each is anchored at the end and runs in linear time. */
const TEST_BASENAME: readonly RegExp[] = [
  /\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs)$/,
  /\.(?:e2e|pw)\.ts$/,
  /^test_.+\.py$/,
  /_test\.py$/,
  /_test\.go$/,
];

/**
 * Whether a repo-relative path is a test file, by the test globs of the test-integrity spec: a basename `*.test.*` or
 * `*.spec.*` with a JavaScript or TypeScript extension, `*.e2e.ts`, `*.pw.ts`, Python `test_*.py` and `*_test.py`, Go
 * `*_test.go`, or any file below a directory that is exactly `test`, `tests` or `__tests__`. Case-sensitive, whole
 * segments only. By name only: it reads no file.
 */
export function isTestFile(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  if (TEST_BASENAME.some((pattern) => pattern.test(basename))) return true;
  return segments.slice(0, -1).some((segment) => TEST_DIRECTORIES.has(segment));
}

/**
 * Whether a path is a snapshot file by its name: the basename ends in `.snap` and is longer than that. Case-sensitive;
 * by name only, it reads no file. Narrower than TI08's snapshot test (`isSnapshotFile`), which also takes
 * `__snapshots__` directories.
 */
export function isSnapFile(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return basename.length > ".snap".length && basename.endsWith(".snap");
}

/** Selects the files whose added and removed line text the diff reader keeps: the test files, by new or old path. */
export function keepTestFileText(file: { path: string; oldPath: string }): boolean {
  return isTestFile(file.path) || isTestFile(file.oldPath);
}

/**
 * The name a test shares with the source it covers: the basename without its extension, then without a `.test`,
 * `.spec`, `.e2e` or `.pw` infix, a `test_` prefix or a `_test` suffix. `src/foo.test.ts`, `tests/test_foo.py` and
 * `src/foo.ts` all give `foo`.
 */
export function testStem(path: string): string {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  let stem = dot > 0 ? basename.slice(0, dot) : basename;
  stem = stem.replace(/\.(?:test|spec|e2e|pw)$/, "");
  if (stem.startsWith("test_") && stem.length > "test_".length) stem = stem.slice("test_".length);
  if (stem.endsWith("_test") && stem.length > "_test".length) stem = stem.slice(0, -"_test".length);
  return stem;
}

/**
 * The directory of the package a test belongs to: its own directory, or, when it lies in or below a `test`, `tests` or
 * `__tests__` folder, the directory that holds the nearest such folder. The empty string is the repository root.
 */
export function testPackageDir(path: string): string {
  const directories = path.split("/").slice(0, -1);
  let nearest = -1;
  for (let i = directories.length - 1; i >= 0; i--) {
    if (TEST_DIRECTORIES.has(directories[i] as string)) {
      nearest = i;
      break;
    }
  }
  return (nearest === -1 ? directories : directories.slice(0, nearest)).join("/");
}

/** A line that opens a test: `it(`, `test(`, `describe(`, `context(` or `specify(` (dotted modifiers allowed), `def test_`, `func Test`. */
const DEFINES_TEST =
  /^(?:(?:it|test|describe|context|specify)(?:\.[A-Za-z]+)*\s*[(`]|(?:async\s+)?def\s+test_|func\s+Test)/;

/** Whether one line of a test file (any indentation) opens a test. Reads at most the first 400 characters. */
export function definesTests(text: string): boolean {
  return DEFINES_TEST.test(text.slice(0, 400).trimStart());
}

/**
 * The test files the diff deletes, or renames to a path that is not a test file (reported under their old
 * path). Added, modified and test-to-test renamed files are not named. Distinct, sorted in code-unit order.
 */
export function deletedTestFiles(diff: readonly DiffFile[]): string[] {
  const found = new Set<string>();
  for (const file of diff) {
    if (file.status === "deleted" && isTestFile(file.path)) found.add(file.path);
    else if (file.status === "renamed" && isTestFile(file.oldPath) && !isTestFile(file.path)) found.add(file.oldPath);
  }
  return [...found].sort(byCodeUnit);
}
