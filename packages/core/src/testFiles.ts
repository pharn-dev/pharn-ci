import type { DiffFile } from "./diff/unified.js";

const TEST_DIRECTORIES: ReadonlySet<string> = new Set(["test", "tests", "__tests__"]);

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Whether a repo-relative path looks like a test file, by name only: `.test.` or `.spec.` in the basename, or a
 * directory segment that is exactly `test`, `tests` or `__tests__`. Case-sensitive, whole segments only.
 */
export function isTestFile(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  if (basename.includes(".test.") || basename.includes(".spec.")) return true;
  return segments.slice(0, -1).some((segment) => TEST_DIRECTORIES.has(segment));
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
