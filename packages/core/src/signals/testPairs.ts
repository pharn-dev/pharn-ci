import type { DiffFile } from "../diff/unified.js";
import { isTestFile } from "../testFiles.js";
import { indexTestFile } from "../testIndex/indexTestFile.js";
import type { PythonTestIndex } from "../testIndex/pythonSides.js";
import type { PythonIndexFile } from "../testIndex/pythonTypes.js";
import type { TestBlock, TestIndexResult } from "../testIndex/types.js";
import type { TestSourceSide, TestSources } from "../testSources.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The language of a test file the base-and-head signals read. */
export type TestLanguage = "ts" | "js" | "py";

const EXTENSION_LANGUAGE: ReadonlyMap<string, TestLanguage> = new Map([
  ["ts", "ts"],
  ["tsx", "ts"],
  ["mts", "ts"],
  ["cts", "ts"],
  ["js", "js"],
  ["jsx", "js"],
  ["mjs", "js"],
  ["cjs", "js"],
  ["py", "py"],
]);

/** The language of a path by its extension (case-sensitive), or null: Go and every other extension are not read. */
export function languageOf(path: string): TestLanguage | null {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return null;
  return EXTENSION_LANGUAGE.get(basename.slice(dot + 1)) ?? null;
}

/** A test file present on both sides: the tests (kind `test` only) at its base path and at its head path. */
export interface ComparedTestFile {
  basePath: string;
  headPath: string;
  base: TestBlock[];
  head: TestBlock[];
}

/** A test file the change adds: the tests it holds at head. */
export interface AddedTestFile {
  headPath: string;
  head: TestBlock[];
}

/** A compared file that could not be compared, and why: a drop reason, `missing`, or a refusal or Python reason. */
export interface UncomparedTestFile {
  path: string;
  reason: string;
}

export interface TouchedTests {
  /** Sorted by base path, then head path. */
  pairs: ComparedTestFile[];
  /** Sorted by head path. */
  added: AddedTestFile[];
  /** Sorted by path. */
  unavailable: UncomparedTestFile[];
  /** Why no file was compared (a side of the sources is unavailable and a compared file exists), else null. */
  notRun: string | null;
  /** The sorted languages of every file a parser accepted on either side. */
  languages: TestLanguage[];
}

type SideIndex = { ok: true; tests: TestBlock[] } | { ok: false; reason: string };

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

function testsOf(result: TestIndexResult): SideIndex {
  return result.parsed
    ? { ok: true, tests: result.tests.filter((block) => block.kind === "test") }
    : { ok: false, reason: result.reason };
}

/** The Python index results of each side by path. */
interface PythonLookup {
  unavailable: string | null;
  base: Map<string, TestIndexResult>;
  head: Map<string, TestIndexResult>;
}

function pythonLookupOf(index: PythonTestIndex | undefined): PythonLookup {
  const mapOf = (files: readonly PythonIndexFile[]) => new Map(files.map((file) => [file.path, file.result]));
  if (index === undefined) return { unavailable: "python-not-found", base: new Map(), head: new Map() };
  if (!index.available) return { unavailable: index.reason, base: new Map(), head: new Map() };
  return { unavailable: null, base: mapOf(index.base), head: mapOf(index.head) };
}

/**
 * Indexes the test files the diff touches at the merge base and at HEAD, for the base-and-head signals.
 *
 * A compared file is a diff entry that is `modified`, or `renamed` with a test-file path on both sides, whose new path
 * has a JavaScript or TypeScript extension or ends in `.py`; it is read at its old path on the base side and its new
 * path on the head side. An added test file of those languages is indexed on the head side only. A deleted file is not
 * indexed (TI01 owns it). JavaScript and TypeScript text goes to `indexTestFile`; Python results come from `python`.
 * When a side of the sources is unavailable and a compared file exists, nothing is indexed and `notRun` says why.
 */
export function indexTouchedTestFiles(
  diff: readonly DiffFile[],
  sources: TestSources,
  python: PythonTestIndex | undefined,
): TouchedTests {
  const comparedPaths = new Map<string, { basePath: string; headPath: string; language: TestLanguage }>();
  const addedPaths = new Map<string, TestLanguage>();
  for (const file of diff) {
    const language = languageOf(file.path);
    if (language === null || !isTestFile(file.path)) continue;
    if (file.status === "modified" || (file.status === "renamed" && isTestFile(file.oldPath))) {
      comparedPaths.set(`${file.oldPath}\0${file.path}`, { basePath: file.oldPath, headPath: file.path, language });
    } else if (file.status === "added") {
      addedPaths.set(file.path, language);
    }
  }

  if (comparedPaths.size > 0) {
    const why = [
      ...new Set([sources.base, sources.head].flatMap((side) => ("unavailable" in side ? [side.unavailable] : []))),
    ];
    if (why.length > 0) return { pairs: [], added: [], unavailable: [], notRun: why.join("; "), languages: [] };
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
    if (language === "py") {
      if (pythonSide.unavailable !== null) return { ok: false, reason: pythonSide.unavailable };
      const found = pythonSide[side].get(path);
      if (found === undefined) return { ok: false, reason: "missing" };
      result = found;
    } else {
      result = indexTestFile(path, text);
    }
    const indexed = testsOf(result);
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
      pairs.push({ basePath: file.basePath, headPath: file.headPath, base: base.tests, head: head.tests });
    } else {
      const reason = base.ok ? (head as { reason: string }).reason : base.reason;
      unavailable.push({ path: file.headPath, reason });
    }
  }
  unavailable.sort((a, b) => byCodeUnit(a.path, b.path));

  const added: AddedTestFile[] = [];
  for (const [headPath, language] of [...addedPaths].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    const head = indexSide("head", headPath, language);
    if (head.ok) added.push({ headPath, head: head.tests });
  }
  return { pairs, added, unavailable, notRun: null, languages: [...languages].sort(byCodeUnit) };
}
