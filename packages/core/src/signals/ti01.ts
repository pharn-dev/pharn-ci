import { BINARY_DELETED_DETAIL, BINARY_RENAMED_AWAY_DETAIL } from "../binaryDetails.js";
import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { definesTests, isRenamedAwayTest, isSnapFile, isTestFile, testPackageDir, testStem } from "../testFiles.js";
import { indexTestFile } from "../testIndex/indexTestFile.js";
import type { PythonTestIndex } from "../testIndex/pythonSides.js";
import type { TestIndexResult } from "../testIndex/types.js";
import type { TestSources } from "../testSources.js";
import { byCodeUnit, cutCodeUnits } from "../text.js";
import { coverageSourceLanguage } from "./signalFiles.js";
import { testLanguage } from "./testLines.js";
import type { DeletedTestFile, DeletedTestFiles } from "./testMatch.js";
import { languageOf } from "./testPairs.js";

const MAX_DETAIL = 300;

/**
 * The deleted test files for which the diff also adds a test file, or renames a file to a test path, at another path
 * with the same stem (`testStem`). A renamed-away file is never in it: only a deletion is replaced. The stem only lifts
 * the name check of the moved-file rule of `matchTests` and picks the detail of TI01; the tests' bodies decide the
 * severity.
 */
export function sameStemDeletions(diff: readonly DiffFile[]): Set<string> {
  const stems = new Map<string, Set<string>>();
  for (const file of diff) {
    if ((file.status !== "added" && file.status !== "renamed") || !isTestFile(file.path)) continue;
    const stem = testStem(file.path);
    const paths = stems.get(stem);
    if (paths === undefined) stems.set(stem, new Set([file.path]));
    else paths.add(file.path);
  }
  const linked = new Set<string>();
  for (const file of diff) {
    if (file.status !== "deleted" || !isTestFile(file.path) || file.binary === true) continue;
    const paths = stems.get(testStem(file.path));
    if (paths === undefined) continue;
    for (const path of paths) {
      if (path !== file.path) {
        linked.add(file.path);
        break;
      }
    }
  }
  return linked;
}

/** The deleted test files, indexed at the merge base: the input of the moved-file rule of `matchTests`. */
export interface IndexedDeletedFiles extends DeletedTestFiles {
  /**
   * The deleted test files whose base text was kept (or, for Python, indexed) but that the test index refused
   * (`syntax-error-heavy`, `too-deep`, `parser-threw`, ...): never in `files`. TI01 says their text could not be parsed,
   * not that it was not available.
   */
  unparsed: ReadonlySet<string>;
}

/**
 * Indexes the base text of every test file the diff deletes (a binary one is skipped), in path order: JS/TS by the test
 * index, Python by the Python index's base entries. `files` lists each one that parsed, with the `test` blocks in line
 * order and the `describe` blocks; a file that held no test is listed too. `unparsed` is every deleted file whose text
 * was there but the index refused, and `stemLinked` is `sameStemDeletions`. All three are empty when the base side of
 * the sources is unavailable; a deleted Python file needs the Python index.
 */
export function indexDeletedTestFiles(
  diff: readonly DiffFile[],
  sources: TestSources,
  python: PythonTestIndex | undefined,
): IndexedDeletedFiles {
  const indexed: IndexedDeletedFiles = { files: [], unparsed: new Set(), stemLinked: new Set() };
  if ("unavailable" in sources.base) return indexed;
  const deleted = diff
    .filter((file) => file.status === "deleted" && isTestFile(file.path) && file.binary !== true)
    .map((file) => file.path)
    .sort(byCodeUnit);
  if (deleted.length === 0) return indexed;

  const texts = new Map(sources.base.files.map((file) => [file.path, file.text]));
  const pythonBase = python?.available ? new Map(python.base.map((file) => [file.path, file.result])) : null;
  const files: DeletedTestFile[] = [];
  const unparsed = new Set<string>();
  for (const path of new Set(deleted)) {
    const language = languageOf(path);
    let result: TestIndexResult | undefined;
    if (language === "py") result = pythonBase?.get(path);
    else if (language !== null) {
      const text = texts.get(path);
      if (text !== undefined) result = indexTestFile(path, text);
    }
    if (result === undefined) continue;
    if (!result.parsed) {
      unparsed.add(path);
      continue;
    }
    files.push({
      path,
      tests: result.tests.filter((block) => block.kind === "test").sort((a, b) => a.line - b.line),
      groups: result.tests.filter((block) => block.kind === "describe"),
    });
  }
  return { files, unparsed, stemLinked: sameStemDeletions(diff) };
}

/** Whether the lines the diff removed from this file define tests; `unknown` when the text was not kept. */
function removedTests(file: DiffFile): "yes" | "no" | "unknown" {
  if (file.hunks === undefined) return "unknown";
  for (const hunk of file.hunks) {
    for (const removed of hunk.removed) if (definesTests(removed.text)) return "yes";
  }
  return "no";
}

/**
 * TI01, a test file deleted. A candidate is a test file the diff deletes, or renames away (named by its old path): to a
 * path that is not a test file, or from a name that matched a test basename pattern to one that matches none, even
 * inside a `test`, `tests` or `__tests__` directory (`isRenamedAwayTest`). It counts when its removed lines define
 * tests, when its text is unknown (not kept), when it is a JS/TS, Python or Go file whose text was cut at the bound, or
 * when it is renamed away: a rename shows only the lines it edits, never the tests it keeps, so a renamed-away file
 * counts whatever its removed lines hold. A counting file is
 * `block` (shown as `warn` in mode `warn`), or `info` when the same diff also deletes a source file with the same name,
 * deletes JS/TS or Python source files of the package that holds the test (never the repository root) and no JS/TS or
 * Python file of that package is left in `repoFiles` (the head tracked-file list; empty shows no remaining file), or (for a deleted file in
 * `moved`, the moved-file rule of `matchTests`, fed by `indexDeletedTestFiles`) when every test it held is found again, by body, in a new test of this change. A
 * deleted file with a same-stem test file added or renamed to (`sameStemDeletions`) needs no name match, only the body
 * evidence; without it the file stays `block` and the detail says whether its tests were compared (`compared`), its
 * base text was read but could not be parsed (`unparsed`), or the text was not available. A renamed-away file is never
 * softened by a same-stem file. A snapshot (`.snap`) path is never a candidate: it holds no test, only stored output.
 * One signal per file, sorted by path. No file content reaches a signal.
 *
 * A candidate that git shows as binary (a `-diff` or `binary` attribute in `.gitattributes`, or non-text content) counts
 * on its path alone, when it is a JS/TS, Python or Go test file (`testLanguage`) and not a `.snap` file: the diff shows
 * no removed line, so its text was not read, and the signal is the mode's severity with a fixed sentence (CORE-50).
 * Fail closed: no `info` softening applies to it (a same-name source or the rest of the package deleted alongside, a
 * moved or same-stem test), because the change that hides a test file's text is the evasion this rule closes, and
 * those softenings rest on path evidence the same change controls. `indexDeletedTestFiles` skips binary entries, so the
 * moved and same-stem softenings never hold a binary path either. Known false blocks, cleared by the accept label: a binary
 * helper file under a test directory (`conftest.py`, a `.d.ts`), a binary test file deleted with its same-name source
 * or its whole package, and a test file deleted or renamed away under an attribute the repository already carried. A
 * binary candidate in another language (an image, `.bin`, `.json`) is not counted.
 */
export function detectTI01(
  diff: readonly DiffFile[],
  mode: "block" | "warn",
  moved: ReadonlySet<string> = new Set(),
  compared: ReadonlySet<string> = new Set(),
  unparsed: ReadonlySet<string> = new Set(),
  repoFiles: readonly string[] = [],
): TestIntegritySignal[] {
  const deletedSources = diff.filter((file) => file.status === "deleted" && !isTestFile(file.path));
  const sourceStems = new Set(deletedSources.map((file) => testStem(file.path)));
  const deletedCode = deletedSources.filter((file) => coverageSourceLanguage(file.path) !== null);
  const sameStem = sameStemDeletions(diff);

  // Whether a JS/TS or Python file (source or test) of the package is still tracked at head; once per package directory.
  const codeRemaining = new Map<string, boolean>();
  const hasCodeRemaining = (dir: string): boolean => {
    let remaining = codeRemaining.get(dir);
    if (remaining === undefined) {
      remaining = repoFiles.some((path) => path.startsWith(`${dir}/`) && coverageSourceLanguage(path) !== null);
      codeRemaining.set(dir, remaining);
    }
    return remaining;
  };

  const found = new Map<string, TestIntegritySignal>();
  for (const file of diff) {
    const renamedAway = isRenamedAwayTest(file);
    const deleted = file.status === "deleted" && isTestFile(file.path);
    if (!(renamedAway || deleted)) continue;
    const path = renamedAway ? file.oldPath : file.path;
    if (isSnapFile(path) || found.has(path)) continue;

    if (file.binary === true) {
      if (testLanguage(path) === null) continue;
      found.set(path, {
        id: "TI01",
        severity: mode,
        path,
        line: null,
        detail: renamedAway ? BINARY_RENAMED_AWAY_DETAIL : BINARY_DELETED_DETAIL,
      });
      continue;
    }

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
      ? isTestFile(file.path)
        ? "Test file renamed to a name that matches no test file pattern, so its tests are no longer found by name."
        : "Test file renamed to a path that is not a test file, so its tests are no longer found by name."
      : defined === "yes"
        ? "Test file deleted; its removed lines defined tests."
        : "Test file deleted; the diff text was cut or not read, so it cannot be confirmed to hold no tests.";
    let severity: TestIntegritySignal["severity"] = mode;

    if (sourceStems.has(stem)) {
      severity = "info";
      detail = "Test file deleted together with a source file of the same name.";
    } else if (
      dir !== "" &&
      deletedCode.some((source) => source.path.startsWith(`${dir}/`)) &&
      !hasCodeRemaining(dir)
    ) {
      severity = "info";
      detail = "Test file deleted together with other files of its package.";
    } else if (deleted && sameStem.has(path)) {
      // A test file of the same name was added: the name only picks the detail, the tests' bodies decide the severity.
      if (moved.has(path)) {
        severity = "info";
        detail =
          "Test file replaced by a test file of the same name; every test it held is found again, by body, in a new test of this change.";
      } else if (compared.has(path)) {
        detail =
          "Test file deleted; a test file of the same name was added, but not every test it held is found again by body.";
      } else if (unparsed.has(path)) {
        detail =
          "Test file deleted; a test file of the same name was added, but its text at the merge base could not be parsed to compare their tests.";
      } else {
        detail =
          "Test file deleted; a test file of the same name was added, but the text to compare their tests was not available.";
      }
    } else if (deleted && moved.has(path)) {
      severity = "info";
      detail =
        "Test file deleted; every test it held is found again, by name and body, in another test file of this change.";
    }

    found.set(path, { id: "TI01", severity, path, line: null, detail: cutCodeUnits(detail, MAX_DETAIL) });
  }
  return [...found.values()].sort((a, b) => byCodeUnit(a.path, b.path));
}
