import type { DiffFile, DiffHunk } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
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

/** The most TI03 signals one file gives; the rest are dropped, keeping the lowest line numbers. */
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

function pythonSkip(text: string): SkipLine | null {
  const parsed = parsePythonSkip(text);
  if (parsed === null) return null;
  const key = keyOf(parsed.token, parsed.name);
  if (parsed.kind === "call") return { key, shape: "in-body", name: parsed.name };
  return { key, shape: parsed.conditional ? "conditional" : "decorator", name: parsed.name };
}

function goSkip(text: string): SkipLine | null {
  const parsed = parseGoSkip(text);
  return parsed === null ? null : { key: keyOf(parsed.token, parsed.name), shape: "in-body", name: parsed.name };
}

function readSkip(language: TestLanguage, text: string): SkipLine | null {
  if (language === "python") return pythonSkip(text);
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

/** The skip lines the file's removed lines held, as keys. */
function removedSkips(hunks: readonly DiffHunk[], language: TestLanguage): Set<string> {
  const keys = new Set<string>();
  for (const hunk of hunks) {
    for (const entry of hunk.removed) {
      const skip = readSkip(language, entry.text);
      if (skip !== null) keys.add(skip.key);
    }
  }
  return keys;
}

interface Found {
  line: number;
  category: Category;
}

function findingsOf(file: DiffFile, hunks: readonly DiffHunk[], language: TestLanguage): Found[] {
  const before = removedSkips(hunks, language);
  const openings = language === "jsts" ? removedOpenings(hunks) : new Set<string>();
  const found: Found[] = [];
  for (const hunk of hunks) {
    hunk.added.forEach((entry, index) => {
      const skip = readSkip(language, entry.text);
      if (skip === null || before.has(skip.key)) return;
      let category: Category;
      if (file.status === "added") category = "adds";
      else if (skip.shape === "conditional") category = "conditional";
      else if (skip.shape === "in-body") category = "cannot-place";
      else if (skip.shape === "named") category = openings.has(skip.name) ? "existing" : "adds";
      else category = hunk.added.slice(index + 1).some((later) => opensPythonTest(later.text)) ? "adds" : "existing";
      found.push({ line: entry.line, category });
    });
  }
  return found;
}

/**
 * TI03, a skip added to a test file. An added line that starts with a skip form is one signal, at its line in the new
 * file: JS/TS `.skip`, `x`-prefixed heads, `.todo`, `.fails`, `skipIf(true)`, `runIf(false)` and the conditional
 * `skipIf`/`runIf`/nameless `.skip(cond)`, `this.skip(`; Python `@pytest.mark.skip`, `skipif`, `xfail`,
 * `@unittest.skip*` and `pytest.skip(`; Go `t.Skip(`, `t.Skipf(`, `t.SkipNow(`. A removed line of the same file with the
 * same form and name (an edit or a move) accounts for it. The rest is sorted in this order: a file the change adds, a
 * conditional skip, a skip inside a body, a skip of a test the change adds (all `warn`), and an unconditional skip of a
 * test the diff shows existed (the mode as its severity). At most 20 per file, on the lowest line numbers. The detail is
 * one fixed sentence per category; no test text reaches a signal.
 */
export function detectTI03(diff: readonly DiffFile[], mode: "block" | "warn"): TestIntegritySignal[] {
  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || !isTestFile(file.path)) continue;
    const language = testLanguage(file.path);
    if (language === null) continue;
    const found = findingsOf(file, file.hunks, language).sort((a, b) => a.line - b.line);
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
