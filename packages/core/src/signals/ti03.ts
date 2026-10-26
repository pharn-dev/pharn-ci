import type { DiffFile, DiffHunk } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import type { TestSourceSide, TestSources } from "../testSources.js";
import { pythonImportAliases } from "./pythonAliases.js";
import {
  type JsTestLine,
  opensPythonTest,
  parseGoSkip,
  parseJsTestCall,
  parsePythonSkip,
  type TestLanguage,
  testLanguage,
} from "./testLines.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The most TI03 signals one file gives. The unconditional skips of existing tests (the ones that take the mode as their
 * severity) are kept first, then the rest, each on the lowest line numbers, so warn findings can never push a block out.
 */
const MAX_PER_FILE = 20;

type Category = "existing" | "conditional" | "cannot-place" | "adds";

/** One fixed sentence per category. None holds test text, a reason or a condition. */
const DETAILS: Readonly<Record<Category, string>> = {
  existing:
    "An unconditional skip was added to a test that the diff shows existed before this change, so that test no longer runs.",
  conditional: "A conditional skip was added; the test is skipped only where its condition holds.",
  "cannot-place":
    "A skip was added inside a test body or hook, where the diff cannot tell which test it stops or whether a condition guards it.",
  adds: "A skip was added to a test that this change adds, so no test that ran before stops running.",
};

/**
 * What a skip line is before the file is considered. `named` is a skip of a test the line itself names (JS/TS);
 * `decorator` is a Python decorator above a test the line does not show.
 */
type Shape = "conditional" | "in-body" | "named" | "decorator";

interface SkipLine {
  /** What the line does, with the name: two lines with the same token and name are the same skip. */
  key: string;
  shape: Shape;
  /** For a `named` JS/TS skip: the name to look for among the test-opening lines the diff removed. */
  name: string;
}

const keyOf = (token: string, name: string) => `${token}\u0000${name}`;

/** The skip a JS/TS line makes, or null when it is not one (including `skipIf(false)` and `runIf(true)`). */
function jsSkip(parsed: JsTestLine): SkipLine | null {
  const { token, name, condition } = parsed;
  const key = keyOf(parsed.kind === "this-skip" ? "this.skip" : token, name);
  if (parsed.kind === "this-skip") return { key, shape: "in-body", name };
  switch (token) {
    case "skip":
      if (parsed.named) return { key, shape: "named", name };
      // `test.skip()` and `test.skip(true)` stop the test they sit in; any other nameless first argument is a condition.
      return { key, shape: parsed.arg === "" || parsed.arg === "true" ? "in-body" : "conditional", name };
    case "todo":
    case "fails":
      return { key, shape: "named", name };
    case "skipIf":
      if (condition === "false") return null;
      return { key, shape: condition === "true" ? "named" : "conditional", name };
    case "runIf":
      if (condition === "true") return null;
      return { key, shape: condition === "false" ? "named" : "conditional", name };
    default:
      return null;
  }
}

/**
 * The skip a Python line makes. The literal spelling is tried first; the file's aliases are asked for (and read from the
 * text, once) only when the line has the shape of a decorator or a call and the literal spelling is not a skip.
 */
function pythonSkip(text: string, aliases: AliasSource | undefined): SkipLine | null {
  let parsed = parsePythonSkip(text);
  if (parsed === null && aliases !== undefined && (text.includes("@") || text.includes("("))) {
    const map = aliases();
    if (map !== undefined) parsed = parsePythonSkip(text, map);
  }
  if (parsed === null) return null;
  const key = keyOf(parsed.token, parsed.name);
  if (parsed.kind === "call") return { key, shape: "in-body", name: parsed.name };
  return { key, shape: parsed.conditional ? "conditional" : "decorator", name: parsed.name };
}

function goSkip(text: string): SkipLine | null {
  const parsed = parseGoSkip(text);
  return parsed === null ? null : { key: keyOf(parsed.token, parsed.name), shape: "in-body", name: parsed.name };
}

function readSkip(language: TestLanguage, text: string, aliases?: AliasSource): SkipLine | null {
  if (language === "python") return pythonSkip(text, aliases);
  if (language === "go") return goSkip(text);
  const parsed = parseJsTestCall(text);
  return parsed === null ? null : jsSkip(parsed);
}

/** The names of the JS/TS test-opening lines the file's removed lines held. */
function removedOpenings(hunks: readonly DiffHunk[]): Set<string> {
  const names = new Set<string>();
  for (const hunk of hunks) {
    for (const entry of hunk.removed) {
      const parsed = parseJsTestCall(entry.text);
      if (parsed !== null && parsed.kind === "call") names.add(parsed.name);
    }
  }
  return names;
}

/** The skip lines the file's removed lines held, as keys (read with the base side's aliases). */
function removedSkips(hunks: readonly DiffHunk[], language: TestLanguage, aliases?: AliasSource): Set<string> {
  const keys = new Set<string>();
  for (const hunk of hunks) {
    for (const entry of hunk.removed) {
      const skip = readSkip(language, entry.text, aliases);
      if (skip !== null) keys.add(skip.key);
    }
  }
  return keys;
}

/** The name a Python test-opening line gives (`test_x` of `def test_x(`, `TestX` of `class TestX`), else null. */
function pythonTestName(text: string): string | null {
  const match = /^(?:async\s+)?def\s+(test_\w*)|^class\s+(Test\w*)/.exec(text.trimStart());
  return match === null ? null : ((match[1] ?? match[2]) as string);
}

/**
 * What an added Python skip decorator at `index` sits on. It reads the added lines directly below it (each on the next
 * line number, so a context line or a gap ends the run), passing over other decorators, comments and blank lines. A
 * `def` or `class` there is a test the change adds, unless a removed line of the same hunk opened a test of the same
 * name (the def line was edited, so the test existed). No added line there means the decorator sits on a line the diff
 * does not show: a test that existed.
 */
function decoratedTest(hunk: DiffHunk, index: number): Category {
  let previous = hunk.added[index]?.line ?? 0;
  for (const entry of hunk.added.slice(index + 1)) {
    if (entry.line !== previous + 1) break;
    previous = entry.line;
    const text = entry.text.trimStart();
    if (text === "" || text.startsWith("@") || text.startsWith("#")) continue;
    if (!opensPythonTest(text)) return "adds";
    const name = pythonTestName(text);
    const edited = hunk.removed.some((removed) => name !== null && pythonTestName(removed.text) === name);
    return edited ? "existing" : "adds";
  }
  return "existing";
}

interface Found {
  line: number;
  category: Category;
}

/** The alias map of a Python test file, read from its text on the first call and kept; undefined with no text. */
type AliasSource = () => ReadonlyMap<string, string> | undefined;

/** The text of each file one side of the test sources holds, by path; empty when the side is unavailable or absent. */
function textsOf(side: TestSourceSide | undefined): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  if (side !== undefined && "files" in side) for (const file of side.files) texts.set(file.path, file.text);
  return texts;
}

/** An alias source that reads `text` the first time it is asked, and never when it is not. */
function sourceOf(text: string | undefined): AliasSource {
  let map: ReadonlyMap<string, string> | undefined;
  return () => {
    if (map === undefined && text !== undefined) map = pythonImportAliases(text);
    return map;
  };
}

/**
 * The alias sources of a Python test file: the base one reads the base text of its old path, the head one the head text
 * of its path. A side without text takes the other side's map; with neither, there is no map.
 */
function aliasesOf(
  file: DiffFile,
  language: TestLanguage,
  texts: { base: ReadonlyMap<string, string>; head: ReadonlyMap<string, string> },
): { base?: AliasSource; head?: AliasSource } {
  if (language !== "python") return {};
  const base = sourceOf(texts.base.get(file.oldPath));
  const head = sourceOf(texts.head.get(file.path));
  return { base: () => base() ?? head(), head: () => head() ?? base() };
}

function findingsOf(
  file: DiffFile,
  hunks: readonly DiffHunk[],
  language: TestLanguage,
  aliases: { base?: AliasSource; head?: AliasSource },
): Found[] {
  const before = removedSkips(hunks, language, aliases.base);
  const openings = language === "jsts" ? removedOpenings(hunks) : new Set<string>();
  const found: Found[] = [];
  for (const hunk of hunks) {
    hunk.added.forEach((entry, index) => {
      const skip = readSkip(language, entry.text, aliases.head);
      if (skip === null || before.has(skip.key)) return;
      let category: Category;
      if (file.status === "added") category = "adds";
      else if (skip.shape === "conditional") category = "conditional";
      else if (skip.shape === "in-body") category = "cannot-place";
      else if (skip.shape === "named") category = openings.has(skip.name) ? "existing" : "adds";
      else category = decoratedTest(hunk, index);
      found.push({ line: entry.line, category });
    });
  }
  return found;
}

/**
 * TI03, a skip added to a test file. An added line that starts with a skip form is one signal, at its line in the new
 * file: JS/TS `.skip`, `x`-prefixed heads, `.todo`, `.fails`, `skipIf(true)`, `runIf(false)` and the conditional
 * `skipIf`/`runIf`/nameless `.skip(cond)`, `this.skip(`; Python `@pytest.mark.skip`, `skipif`, `xfail`,
 * `@unittest.skip*`, `@unittest.expectedFailure`, `pytest.skip(` and `pytest.xfail(`; Go `t.Skip(`, `t.Skipf(`,
 * `t.SkipNow(`. A removed line of the same file with the same form and name (an edit or a move) accounts for it. The rest
 * is sorted in this order: a file the change adds, a conditional skip, a skip inside a body, a skip of a test the change
 * adds (all `warn`), and an unconditional skip of a test the diff shows existed (the mode as its severity). At most 20
 * per file: the skips of existing tests first, then the rest, each on the lowest line numbers. The detail is one fixed
 * sentence per category; no test text reaches a signal.
 *
 * A Python line is also read through the aliases the test file binds with its own top-level `import` / `from` lines
 * (`import pytest as pt`, `from pytest import mark as m`, `from unittest import skipIf as si`), taken from `sources`:
 * removed lines with the base text of the file's old path, added lines with the head text of its path; with only one
 * side's text that map serves both, and with neither (no `sources`, a side unavailable or without the file) only the
 * literal spellings are read, as before. The literal spelling is always tried first, so an alias can only add a match.
 */
export function detectTI03(
  diff: readonly DiffFile[],
  mode: "block" | "warn",
  sources?: TestSources,
): TestIntegritySignal[] {
  const signals: TestIntegritySignal[] = [];
  const texts = { base: textsOf(sources?.base), head: textsOf(sources?.head) };
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || !isTestFile(file.path)) continue;
    const language = testLanguage(file.path);
    if (language === null) continue;
    const rank = (category: Category) => (category === "existing" ? 0 : 1);
    const found = findingsOf(file, file.hunks, language, aliasesOf(file, language, texts)).sort(
      (a, b) => rank(a.category) - rank(b.category) || a.line - b.line,
    );
    for (const { line, category } of found.slice(0, MAX_PER_FILE)) {
      signals.push({
        id: "TI03",
        severity: category === "existing" ? mode : "warn",
        path: file.path,
        line,
        detail: DETAILS[category],
      });
    }
  }
  return signals.sort((a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0));
}
