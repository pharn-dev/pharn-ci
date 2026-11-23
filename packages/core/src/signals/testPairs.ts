import type { DiffFile } from "../diff/unified.js";
import type { TestIndexUnavailable } from "../report.js";
import { type SourceLanguage, sourceLanguage } from "../sourceLanguage.js";
import { isTestFile } from "../testFiles.js";
import { indexTestFileWithImports } from "../testIndex/indexTestFile.js";
import type { PythonTestIndex } from "../testIndex/pythonSides.js";
import type { PythonIndexFile } from "../testIndex/pythonTypes.js";
import type { TestBlock, TestIndexResult, TestModuleMock } from "../testIndex/types.js";
import { BINARY_DIFF_REASON, changeMadeUnreadable } from "../testIntegrityUnreadable.js";
import type { TestSourceSide, TestSources } from "../testSources.js";
import { byCodeUnit } from "../text.js";

/** The language of a test file the base-and-head signals read. */
export type TestLanguage = SourceLanguage;

/** The language of a path by its extension (case-sensitive), or null: Go and every other extension are not read. */
export const languageOf: (path: string) => TestLanguage | null = sourceLanguage;

/**
 * A test file present on both sides: the tests (kind `test` only) at its base path and at its head path, and the module
 * mocks the file holds on each side.
 */
export interface ComparedTestFile {
  basePath: string;
  headPath: string;
  base: TestBlock[];
  head: TestBlock[];
  baseMocks: TestModuleMock[];
  headMocks: TestModuleMock[];
  /** The describe blocks (kind `describe`) at the base path and at the head path, for TI03's pair pass. */
  baseGroups?: TestBlock[];
  headGroups?: TestBlock[];
  /**
   * For the tests-exercise check: the module specifiers a JavaScript or TypeScript file loads at head
   * (`indexTestFileWithImports`), or the module names a Python file imports at head (the Python index's `imports`, empty
   * when it has none).
   */
  headImports?: string[];
}

/** A test file the change adds: the tests and the module mocks it holds at head. */
export interface AddedTestFile {
  headPath: string;
  head: TestBlock[];
  headMocks: TestModuleMock[];
  /** The describe blocks (kind `describe`) it holds at head, for TI03's pair pass. */
  headGroups?: TestBlock[];
  /** The module specifiers a JavaScript or TypeScript file loads at head, or the module names a Python file imports. */
  headImports?: string[];
}

/**
 * A compared file that could not be compared, or an added file whose tests could not be read, and why: a drop reason,
 * `missing`, or a refusal or Python reason.
 */
export interface UncomparedTestFile {
  path: string;
  reason: string;
  /**
   * Set on a compared file whose head side failed for a reason of `HEAD_UNREADABLE_ERROR_REASONS` while its base side
   * indexed or was dropped as `over-file-cap`: the change made the file unreadable to this check. In mode `block` it
   * makes the `TEST_INTEGRITY_INDEX_UNAVAILABLE` message an error. Never set on an added file, and never in the report.
   */
  changeMadeUnreadable?: true;
}

export interface TouchedTests {
  /** Sorted by base path, then head path. */
  pairs: ComparedTestFile[];
  /** Sorted by head path. */
  added: AddedTestFile[];
  /** Sorted by path. */
  unavailable: UncomparedTestFile[];
  /**
   * The added test files whose head side could not be indexed (dropped, missing, refused by the test index, or no
   * Python index), sorted by path. They are in no other list, so nothing that reads `added` checks their tests; the
   * report names them. Empty when `notRun` is set, and when the head side of the sources is unavailable: then no file
   * has text, the CLI and the Action log why, and an added file cannot hide a weakened existing test.
   */
  unreadAdded: UncomparedTestFile[];
  /** Why no file was compared (a side of the sources is unavailable and a compared file exists), else null. */
  notRun: string | null;
  /** The sorted languages of every file a parser accepted on either side. */
  languages: TestLanguage[];
}

type SideIndex =
  | { ok: true; tests: TestBlock[]; groups: TestBlock[]; mocks: TestModuleMock[]; imports: string[] | undefined }
  | { ok: false; reason: string };

interface SideLookup {
  texts: Map<string, string>;
  dropped: Map<string, string>;
}

function lookupOf(side: TestSourceSide): SideLookup {
  const texts = new Map<string, string>();
  const dropped = new Map<string, string>();
  if (!("unavailable" in side)) {
    for (const file of side.files) texts.set(file.path, file.text);
    for (const drop of side.dropped) dropped.set(drop.path, drop.reason);
  }
  return { texts, dropped };
}

function testsOf(result: TestIndexResult, imports: string[] | undefined): SideIndex {
  return result.parsed
    ? {
        ok: true,
        tests: result.tests.filter((block) => block.kind === "test"),
        groups: result.tests.filter((block) => block.kind === "describe"),
        mocks: result.mocks,
        imports,
      }
    : { ok: false, reason: result.reason };
}

/** The Python index files of each side by path. */
interface PythonLookup {
  unavailable: string | null;
  base: Map<string, PythonIndexFile>;
  head: Map<string, PythonIndexFile>;
}

function pythonLookupOf(index: PythonTestIndex | undefined): PythonLookup {
  const mapOf = (files: readonly PythonIndexFile[]) => new Map(files.map((file) => [file.path, file]));
  if (index === undefined) return { unavailable: "python-not-found", base: new Map(), head: new Map() };
  if (!index.available) return { unavailable: index.reason, base: new Map(), head: new Map() };
  return { unavailable: null, base: mapOf(index.base), head: mapOf(index.head) };
}

interface ComparedEntry {
  basePath: string;
  headPath: string;
  language: TestLanguage;
}

/**
 * The compared set and the added set of a diff. A compared file is a diff entry that is `modified`, or `renamed` with a
 * test-file path on both sides, whose new path is a test file with a JavaScript, TypeScript or `.py` extension; an
 * added file is an `added` entry that is such a test file.
 */
function touchedTestEntries(diff: readonly DiffFile[]): {
  compared: Map<string, ComparedEntry>;
  added: Map<string, TestLanguage>;
} {
  const compared = new Map<string, ComparedEntry>();
  const added = new Map<string, TestLanguage>();
  for (const file of diff) {
    const language = languageOf(file.path);
    if (language === null || !isTestFile(file.path)) continue;
    if (file.status === "modified" || (file.status === "renamed" && isTestFile(file.oldPath))) {
      compared.set(`${file.oldPath}\0${file.path}`, { basePath: file.oldPath, headPath: file.path, language });
    } else if (file.status === "added") {
      added.set(file.path, language);
    }
  }
  return { compared, added };
}

/**
 * The touched test files whose diff entry git shows as binary (CORE-50), by the same compared and added sets the index
 * uses: a modified entry (or a renamed one with a test-file path on both sides) or an added entry whose new path is a
 * test file with a JS/TS or `.py` extension. A modified one is a change made unreadable whatever the merge base held
 * (`BINARY_DIFF_REASON`): it carries `changeMadeUnreadable`. Each list is sorted by path. It reads no test source, so it
 * holds with no sources at all.
 */
export function binaryTouchedTestFiles(diff: readonly DiffFile[]): {
  modified: UncomparedTestFile[];
  added: UncomparedTestFile[];
} {
  const { compared, added: addedPaths } = touchedTestEntries(diff);
  const modified: UncomparedTestFile[] = [];
  const added: UncomparedTestFile[] = [];
  for (const file of diff) {
    if (file.binary !== true) continue;
    if (compared.has(`${file.oldPath}\0${file.path}`)) {
      modified.push({ path: file.path, reason: BINARY_DIFF_REASON, changeMadeUnreadable: true });
    } else if (file.status === "added" && addedPaths.has(file.path)) {
      added.push({ path: file.path, reason: BINARY_DIFF_REASON });
    }
  }
  const byPath = (a: UncomparedTestFile, b: UncomparedTestFile) => byCodeUnit(a.path, b.path);
  return { modified: modified.sort(byPath), added: added.sort(byPath) };
}

/** Merges the entries of a list that have the same path and reason into one, OR-ing `changeMadeUnreadable`; sorted by path. */
function mergeEntries(
  existing: readonly { path: string; reason: string; changeMadeUnreadable?: boolean }[],
  extra: readonly { path: string; reason: string; changeMadeUnreadable?: boolean }[],
): { path: string; reason: string; changeMadeUnreadable?: boolean }[] {
  const merged = new Map<string, { path: string; reason: string; changeMadeUnreadable?: boolean }>();
  for (const entry of [...existing, ...extra]) {
    const key = `${entry.path}\0${entry.reason}`;
    const before = merged.get(key);
    const flagged = before?.changeMadeUnreadable === true || entry.changeMadeUnreadable === true;
    merged.set(key, {
      path: entry.path,
      reason: entry.reason,
      ...(flagged ? { changeMadeUnreadable: true as const } : {}),
    });
  }
  return [...merged.values()].sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.reason, b.reason));
}

/**
 * Adds the binary touched test files (`binaryTouchedTestFiles`) to what the index could not read: its `files` and `added`
 * lists. Each list is keyed by path plus reason; when the index and the diff both give an entry with the same path and
 * reason they become one entry whose `changeMadeUnreadable` is the OR of the two, so the flagged entry wins and an
 * unflagged index entry never hides the diff's block error. An index entry for the same path with another reason stays.
 * The `{ notRun }` form is returned unchanged: it is already the whole-run error and cannot carry files. Undefined when
 * there is nothing to say.
 */
export function withBinaryTestFiles(
  unavailable: TestIndexUnavailable | undefined,
  binary: { modified: readonly UncomparedTestFile[]; added: readonly UncomparedTestFile[] },
): TestIndexUnavailable | undefined {
  if (unavailable !== undefined && "notRun" in unavailable) return unavailable;
  if (binary.modified.length === 0 && binary.added.length === 0) return unavailable;
  const files = mergeEntries(unavailable?.files ?? [], binary.modified);
  const added = mergeEntries(unavailable?.added ?? [], binary.added);
  return { files, ...(added.length > 0 ? { added } : {}) };
}

/**
 * The paths of the compared set (the test files the change modifies, see `indexTouchedTestFiles`): the old paths, read at
 * the merge base, and the new paths, read at HEAD, each de-duplicated and in code-unit order. The sources reader plans
 * these first so that other files cannot use up the file cap ahead of them.
 */
export function modifiedTestSourcePaths(diff: readonly DiffFile[]): { base: string[]; head: string[] } {
  const base = new Set<string>();
  const head = new Set<string>();
  for (const entry of touchedTestEntries(diff).compared.values()) {
    base.add(entry.basePath);
    head.add(entry.headPath);
  }
  return { base: [...base].sort(byCodeUnit), head: [...head].sort(byCodeUnit) };
}

/**
 * Whether no Python interpreter stops the comparison: `python` is given and says `python-not-found`, and the compared
 * set holds a `.py` file. An absent index is not that answer: it means no `.py` text was read, or the caller passed no
 * index, never that `python3` is missing.
 */
export function pythonNotFoundStopsComparison(diff: readonly DiffFile[], python: PythonTestIndex | undefined): boolean {
  if (python === undefined || python.available || python.reason !== "python-not-found") return false;
  for (const entry of touchedTestEntries(diff).compared.values()) {
    if (entry.language === "py") return true;
  }
  return false;
}

/**
 * Indexes the test files the diff touches at the merge base and at HEAD, for the base-and-head signals.
 *
 * A compared file is a diff entry that is `modified`, or `renamed` with a test-file path on both sides, whose new path
 * has a JavaScript or TypeScript extension or ends in `.py`; it is read at its old path on the base side and its new
 * path on the head side. An added test file of those languages is indexed on the head side only; one that does not
 * index goes to `unreadAdded` with its reason, so it is reported, not dropped. A deleted file is not indexed (TI01 owns
 * it). JavaScript and TypeScript text goes to `indexTestFileWithImports`, which also gives the head side's
 * `headImports`; Python results, and a Python file's `headImports`, come from `python`. When a side of the
 * sources is unavailable and a compared file exists, nothing is indexed and `notRun` says why; when `python` says
 * `python-not-found` and a compared `.py` file exists, `notRun` is `python-not-found` (a sources reason wins); when the
 * head side is unavailable and no compared file exists, nothing is indexed or named. A compared file whose head side
 * fails for a reason of `HEAD_UNREADABLE_ERROR_REASONS` while its base side indexed (or was dropped as `over-file-cap`)
 * carries `changeMadeUnreadable` in `unavailable`.
 */
export function indexTouchedTestFiles(
  diff: readonly DiffFile[],
  sources: TestSources,
  python: PythonTestIndex | undefined,
): TouchedTests {
  const { compared: comparedPaths, added: addedPaths } = touchedTestEntries(diff);

  if (comparedPaths.size > 0) {
    const why = [
      ...new Set([sources.base, sources.head].flatMap((side) => ("unavailable" in side ? [side.unavailable] : []))),
    ];
    if (why.length > 0) {
      return { pairs: [], added: [], unavailable: [], unreadAdded: [], notRun: why.join("; "), languages: [] };
    }
    if (pythonNotFoundStopsComparison(diff, python)) {
      return { pairs: [], added: [], unavailable: [], unreadAdded: [], notRun: "python-not-found", languages: [] };
    }
  } else if ("unavailable" in sources.head) {
    return { pairs: [], added: [], unavailable: [], unreadAdded: [], notRun: null, languages: [] };
  }

  const baseSide = lookupOf(sources.base);
  const headSide = lookupOf(sources.head);
  const pythonSide = pythonLookupOf(python);
  const languages = new Set<TestLanguage>();

  const indexSide = (side: "base" | "head", path: string, language: TestLanguage): SideIndex => {
    const lookup = side === "base" ? baseSide : headSide;
    const text = lookup.texts.get(path);
    if (text === undefined) return { ok: false, reason: lookup.dropped.get(path) ?? "missing" };
    let result: TestIndexResult;
    let imports: string[] | undefined;
    if (language === "py") {
      if (pythonSide.unavailable !== null) return { ok: false, reason: pythonSide.unavailable };
      const found = pythonSide[side].get(path);
      if (found === undefined) return { ok: false, reason: "missing" };
      result = found.result;
      imports = found.imports ?? [];
    } else {
      const indexed = indexTestFileWithImports(path, text);
      result = indexed.result;
      imports = indexed.imports;
    }
    const indexed = testsOf(result, imports);
    if (indexed.ok) languages.add(language);
    return indexed;
  };

  const pairs: ComparedTestFile[] = [];
  const unavailable: UncomparedTestFile[] = [];
  const compared = [...comparedPaths.values()].sort(
    (a, b) => byCodeUnit(a.basePath, b.basePath) || byCodeUnit(a.headPath, b.headPath),
  );
  for (const file of compared) {
    const base = indexSide("base", file.basePath, file.language);
    const head = indexSide("head", file.headPath, file.language);
    if (base.ok && head.ok) {
      pairs.push({
        basePath: file.basePath,
        headPath: file.headPath,
        base: base.tests,
        head: head.tests,
        baseMocks: base.mocks,
        headMocks: head.mocks,
        baseGroups: base.groups,
        headGroups: head.groups,
        ...(head.imports === undefined ? {} : { headImports: head.imports }),
      });
    } else {
      const headReason = head.ok ? null : head.reason;
      const reason = base.ok ? (headReason as string) : base.reason;
      // Only a file whose head side failed can be made unreadable; a head that indexed leaves the flag unset.
      const unreadable = headReason !== null && changeMadeUnreadable(base, headReason);
      unavailable.push({ path: file.headPath, reason, ...(unreadable ? { changeMadeUnreadable: true as const } : {}) });
    }
  }
  unavailable.sort((a, b) => byCodeUnit(a.path, b.path));

  const added: AddedTestFile[] = [];
  const unreadAdded: UncomparedTestFile[] = [];
  for (const [headPath, language] of [...addedPaths].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    const head = indexSide("head", headPath, language);
    if (head.ok) {
      added.push({
        headPath,
        head: head.tests,
        headMocks: head.mocks,
        headGroups: head.groups,
        ...(head.imports === undefined ? {} : { headImports: head.imports }),
      });
    } else {
      unreadAdded.push({ path: headPath, reason: head.reason });
    }
  }
  return {
    pairs,
    added,
    unavailable,
    unreadAdded,
    notRun: null,
    languages: [...languages].sort(byCodeUnit),
  };
}
