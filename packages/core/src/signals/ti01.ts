import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { definesTests, isSnapFile, isTestFile, testPackageDir, testStem } from "../testFiles.js";
import { coverageSourceLanguage } from "./signalFiles.js";
import { testLanguage } from "./testLines.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const MAX_DETAIL = 300;

/** Whether the lines the diff removed from this file define tests; `unknown` when the text was not kept. */
function removedTests(file: DiffFile): "yes" | "no" | "unknown" {
  if (file.hunks === undefined) return "unknown";
  for (const hunk of file.hunks) {
    for (const removed of hunk.removed) if (definesTests(removed.text)) return "yes";
  }
  return "no";
}

function addedTests(file: DiffFile): boolean {
  for (const hunk of file.hunks ?? []) {
    for (const added of hunk.added) if (definesTests(added.text)) return true;
  }
  return false;
}

/**
 * TI01, a test file deleted. A candidate is a test file the diff deletes, or renames to a path that is not a test file
 * (named by its old path). It counts when its removed lines define tests, when its text is unknown (not kept), when it
 * is a JS/TS, Python or Go file whose text was cut at the bound, or when it is renamed away: a rename shows only the lines it edits, never the tests it keeps, so a
 * rename to a non-test path counts whatever its removed lines hold. A binary file never counts. A counting file is
 * `block` (shown as `warn` in mode `warn`), or `info` when the same diff also deletes a source file with the same name,
 * deletes other files of the package that holds the test (never the repository root), or adds a test file with the same
 * name that defines tests, or (for a deleted file in `moved`, see `movedTestFiles`) when every test it held is found
 * again, by name and by body, in another test file of this change. A snapshot (`.snap`) path is never a
 * candidate: it holds no test, only stored output. One signal per file, sorted by path. No file content reaches a
 * signal.
 */
export function detectTI01(
  diff: readonly DiffFile[],
  mode: "block" | "warn",
  moved: ReadonlySet<string> = new Set(),
): TestIntegritySignal[] {
  const deletedSources = diff.filter((file) => file.status === "deleted" && !isTestFile(file.path));
  const sourceStems = new Set(deletedSources.map((file) => testStem(file.path)));
  const addedTestFiles = diff.filter(
    (file) => (file.status === "added" || file.status === "renamed") && isTestFile(file.path),
  );

  const found = new Map<string, TestIntegritySignal>();
  for (const file of diff) {
    const renamedAway = file.status === "renamed" && isTestFile(file.oldPath) && !isTestFile(file.path);
    const deleted = file.status === "deleted" && isTestFile(file.path);
    if (!(renamedAway || deleted) || file.binary === true) continue;
    const path = renamedAway ? file.oldPath : file.path;
    if (isSnapFile(path) || found.has(path)) continue;

    const defined = removedTests(file);
    // A cut file counts only when it is code that can define tests: a large fixture, snapshot or data file under a test
    // directory cannot, so cutting its text proves nothing.
    const cutCode =
      file.textTruncated === true && (testLanguage(path) !== null || coverageSourceLanguage(path) !== null);
    const counts = defined === "yes" || defined === "unknown" || cutCode || renamedAway;
    if (!counts) continue;

    const stem = testStem(path);
    const dir = testPackageDir(path);
    let detail = renamedAway
      ? "Test file renamed to a path that is not a test file, so its tests are no longer found by name."
      : defined === "yes"
        ? "Test file deleted; its removed lines defined tests."
        : "Test file deleted; the diff text was cut or not read, so it cannot be confirmed to hold no tests.";
    let severity: TestIntegritySignal["severity"] = mode;

    if (sourceStems.has(stem)) {
      severity = "info";
      detail = "Test file deleted together with a source file of the same name.";
    } else if (dir !== "" && deletedSources.some((source) => source.path.startsWith(`${dir}/`))) {
      severity = "info";
      detail = "Test file deleted together with other files of its package.";
    } else if (
      addedTestFiles.some((added) => added.path !== path && testStem(added.path) === stem && addedTests(added))
    ) {
      severity = "info";
      detail = "Test file replaced by a test file of the same name that defines tests.";
    } else if (deleted && moved.has(path)) {
      severity = "info";
      detail =
        "Test file deleted; every test it held is found again, by name and body, in another test file of this change.";
    }

    found.set(path, { id: "TI01", severity, path, line: null, detail: detail.slice(0, MAX_DETAIL) });
  }
  return [...found.values()].sort((a, b) => byCodeUnit(a.path, b.path));
}
