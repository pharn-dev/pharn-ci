import type { DiffFile } from "../diff/unified.js";
import type { OmittedSignals, TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { escapeDetailText } from "./detailText.js";
import { coverageSourceLanguage } from "./signalFiles.js";
import { testLanguage } from "./testLines.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The most TI15 signals one change gives; the rest are counted per source path in `omitted`. */
const MAX_PER_CHANGE = 10;
/** The longest detail a signal carries. */
const MAX_DETAIL = 300;
/** A string literal needs this many UTF-16 code units, a number this many significant digits. */
const MIN_STRING_LENGTH = 6;
const MIN_SIGNIFICANT_DIGITS = 4;

/** Directory names whose files are examples, benchmarks, docs or fixtures: no literal is taken from them or matched in them. */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set(["examples", "benchmarks", "bench", "docs", "fixtures"]);

/** Whether a directory segment of the path (never the file name) is an excluded directory. */
function inExcludedDir(path: string): boolean {
  const segments = path.split("/");
  for (let i = 0; i < segments.length - 1; i++) if (EXCLUDED_DIRS.has(segments[i] as string)) return true;
  return false;
}

const MANIFEST_NAMES: ReadonlySet<string> = new Set(["package.json", "pyproject.toml"]);

/** The directories that hold a `package.json` or `pyproject.toml`: in the tracked files, or added by the diff. */
function manifestDirs(diff: readonly DiffFile[], repoFiles: readonly string[]): Set<string> {
  const dirs = new Set<string>();
  const note = (path: string) => {
    const slash = path.lastIndexOf("/");
    if (MANIFEST_NAMES.has(path.slice(slash + 1))) dirs.add(slash === -1 ? "" : path.slice(0, slash));
  };
  for (const path of repoFiles) note(path);
  for (const file of diff) if (file.status === "added") note(file.path);
  return dirs;
}

/**
 * The package root of a path: its nearest ancestor directory that holds a manifest, else the empty root. With no
 * manifest known at all, a path under `packages/` or `apps/` takes its first two segments as the root.
 */
function packageRoot(path: string, manifests: ReadonlySet<string>): string {
  if (manifests.size === 0) {
    const segments = path.split("/");
    return segments.length >= 3 && (segments[0] === "packages" || segments[0] === "apps")
      ? `${segments[0]}/${segments[1]}`
      : "";
  }
  let slash = path.lastIndexOf("/");
  while (slash > 0) {
    const dir = path.slice(0, slash);
    if (manifests.has(dir)) return dir;
    slash = path.lastIndexOf("/", slash - 1);
  }
  return "";
}

/**
 * Strings too common to say anything about a test's input; compared case-insensitively. The `typeof` results are on
 * it because `typeof x === "string"` is ordinary code that any test naming a type would otherwise match.
 */
const STOP_LIST: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "function",
  "symbol",
  "bigint",
  "true",
  "false",
  "null",
  "none",
  "undefined",
  "test",
  "error",
  "default",
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "utf-8",
  "utf8",
]);

type Kind = "string" | "number";

/** One literal on a line: its kind, its value as written, and where it starts and ends (end is exclusive). */
interface Literal {
  kind: Kind;
  value: string;
  start: number;
  end: number;
}

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isWordChar = (c: string): boolean =>
  (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
const isBlank = (c: string | undefined): boolean => c === " " || c === "\t";

/** The end (exclusive) of a maximal run of digits that starts at `start`. */
function digitsEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && isDigit(text.charAt(i))) i++;
  return i;
}

/**
 * The string and number literals of one line, found in one left-to-right pass.
 *
 * A string opens at a single quote, a double quote or a backtick and closes at the next unescaped quote of the same kind
 * on the line; a backslash escapes the next character; an unclosed quote ends the scan. The value is the content as
 * written, escapes and all. A backtick literal whose content holds `${` is skipped. A number is a maximal run of
 * `[0-9]+(\.[0-9]+)?` outside strings with no word character or `.` right before or after it. Comments and regular
 * expressions are not understood: a quote in a comment opens a literal like any other.
 */
function scanLiterals(text: string): Literal[] {
  const found: Literal[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        const d = text.charAt(j);
        if (d === "\\") j += 2;
        else if (d === c) {
          closed = true;
          break;
        } else j++;
      }
      if (!closed) break;
      const value = text.slice(i + 1, j);
      if (!(c === "`" && value.includes("${"))) found.push({ kind: "string", value, start: i, end: j + 1 });
      i = j + 1;
    } else if (isDigit(c)) {
      let end = digitsEnd(text, i);
      if (text.charAt(end) === "." && isDigit(text.charAt(end + 1))) end = digitsEnd(text, end + 1);
      const before = i === 0 ? "" : text.charAt(i - 1);
      const after = text.charAt(end);
      const clear = (n: string) => n === "" || !(isWordChar(n) || n === ".");
      if (clear(before) && clear(after)) found.push({ kind: "number", value: text.slice(i, end), start: i, end });
      i = end;
    } else if (isWordChar(c)) {
      // An identifier or a number glued to letters (`v2024`, `1e5`, `0x1f`) is read whole and gives no literal.
      let j = i + 1;
      while (j < text.length && isWordChar(text.charAt(j))) j++;
      i = j;
    } else {
      i++;
    }
  }
  return found;
}

/** The significant digits of a number as written: leading zeros never count, trailing zeros of a number with no `.` do not. */
function significantDigits(value: string): number {
  const hasPoint = value.includes(".");
  let digits = value.replace(".", "").replace(/^0+/, "");
  if (!hasPoint) digits = digits.replace(/0+$/, "");
  return digits.length;
}

/** Whether a literal says enough about an input to be worth comparing. */
function isEligible(literal: Literal): boolean {
  if (literal.kind === "number") return significantDigits(literal.value) >= MIN_SIGNIFICANT_DIGITS;
  return literal.value.length >= MIN_STRING_LENGTH && !STOP_LIST.has(literal.value.toLowerCase());
}

const keyOf = (literal: { kind: Kind; value: string }): string =>
  `${literal.kind === "string" ? "s" : "n"}${literal.value}`;

const isOperatorChar = (c: string): boolean => c === "=" || c === "!" || c === "<" || c === ">";

/** The run of `=`, `!`, `<` and `>` characters that ends the text before index `at` (after blanks), else the empty string. */
function operatorBefore(text: string, at: number): string {
  let end = at;
  while (end > 0 && isBlank(text.charAt(end - 1))) end--;
  let start = end;
  while (start > 0 && isOperatorChar(text.charAt(start - 1))) start--;
  return text.slice(start, end);
}

/** The run of `=`, `!`, `<` and `>` characters that starts the text from index `at` (after blanks), else the empty string. */
function operatorAfter(text: string, at: number): string {
  let start = at;
  while (start < text.length && isBlank(text.charAt(start))) start++;
  let end = start;
  while (end < text.length && isOperatorChar(text.charAt(end))) end++;
  return text.slice(start, end);
}

const EQUALITY: ReadonlySet<string> = new Set(["===", "!==", "==", "!="]);

/** Rule 2: the trimmed line starts with the word `case` and the literal is the next token, followed by `:`. */
function isCaseLabel(trimmed: string, offset: number, literal: Literal): boolean {
  if (!trimmed.startsWith("case") || !isBlank(trimmed.charAt(4))) return false;
  let i = 4;
  while (isBlank(trimmed.charAt(i))) i++;
  if (literal.start - offset !== i) return false;
  let j = literal.end - offset;
  while (isBlank(trimmed.charAt(j))) j++;
  return trimmed.charAt(j) === ":";
}

const CLOSERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/**
 * Rule 3: the bracket groups that follow the whole word `in` (after blanks) on a Python line, as index ranges (the open
 * bracket up to the first closing bracket of the same kind on the line). The word is read outside strings.
 */
function inGroups(text: string, literals: readonly Literal[]): Array<[number, number]> {
  const groups: Array<[number, number]> = [];
  const strings = literals.filter((l) => l.kind === "string");
  let next = 0;
  let i = 0;
  while (i < text.length) {
    while (next < strings.length && (strings[next] as Literal).end <= i) next++;
    const inside = strings[next];
    if (inside !== undefined && i >= inside.start) {
      i = inside.end;
      continue;
    }
    if (!isWordChar(text.charAt(i))) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < text.length && isWordChar(text.charAt(j))) j++;
    if (text.slice(i, j) === "in") {
      let k = j;
      while (isBlank(text.charAt(k))) k++;
      const closer = CLOSERS[text.charAt(k)];
      if (closer !== undefined) {
        const close = text.indexOf(closer, k + 1);
        if (close !== -1) groups.push([k, close]);
      }
    }
    i = j;
  }
  return groups;
}

/** Whether a literal of an added source line is the value of a comparison, a `case` label or a Python `in` group. */
function conditionLiterals(text: string, language: "jsts" | "python"): Literal[] {
  const literals = scanLiterals(text);
  if (literals.length === 0) return [];
  const trimmed = text.trimStart();
  const offset = text.length - trimmed.length;
  const forLoop = trimmed.startsWith("for ") || trimmed.startsWith("async for ");
  const groups = language === "python" && !forLoop ? inGroups(text, literals) : [];

  return literals.filter((literal) => {
    if (!isEligible(literal)) return false;
    if (EQUALITY.has(operatorBefore(text, literal.start))) return true;
    if (EQUALITY.has(operatorAfter(text, literal.end))) return true;
    if (isCaseLabel(trimmed, offset, literal)) return true;
    return groups.some(([open, close]) => literal.start > open && literal.end <= close);
  });
}

/**
 * The eligible literals of the added lines of the test files, each with, per package root, the first test path in
 * code-unit order that adds it. Test files under an excluded directory give none.
 */
function testLiterals(diff: readonly DiffFile[], manifests: ReadonlySet<string>): Map<string, Map<string, string>> {
  const found = new Map<string, Map<string, string>>();
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || file.status === "deleted") continue;
    if (!isTestFile(file.path) || inExcludedDir(file.path)) continue;
    const language = testLanguage(file.path);
    if (language !== "jsts" && language !== "python") continue;
    const root = packageRoot(file.path, manifests);
    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        for (const literal of scanLiterals(entry.text)) {
          if (!isEligible(literal)) continue;
          const key = keyOf(literal);
          const roots = found.get(key) ?? new Map<string, string>();
          const first = roots.get(root);
          if (first === undefined || byCodeUnit(file.path, first) < 0) roots.set(root, file.path);
          found.set(key, roots);
        }
      }
    }
  }
  return found;
}

/**
 * The sentence of a signal. It names the source location, the literal's kind and length (in UTF-16 code units, as
 * written) and the test path, and never any text of the literal: a matched value can be a secret, and the report
 * leaves the job. When the sentence would pass 300 characters the test path gives way to a general phrase, then the
 * source location too.
 */
function detailOf(literal: Literal, sourcePath: string, line: number, testPath: string): string {
  const what = `a ${literal.value.length}-character ${literal.kind} literal`;
  const tail = "so the code may special-case the test's input.";
  const at = `The condition at "${escapeDetailText(`${sourcePath}:${line}`)}" compares with ${what}`;
  const full = `${at} that the test file "${escapeDetailText(testPath)}" also adds, ${tail}`;
  if (full.length <= MAX_DETAIL) return full;
  const noTest = `${at} that a test file in this change also adds, ${tail}`;
  if (noTest.length <= MAX_DETAIL) return noTest;
  return `This condition compares with ${what} that a test file in this change also adds, ${tail}`;
}

export interface TI15Options {
  /** Repo-relative tracked paths (`git ls-files`); the manifests among them decide the package roots. Empty means unknown. */
  repoFiles: readonly string[];
}

export interface TI15Result {
  signals: TestIntegritySignal[];
  /** The findings past the 10 per change, counted per source path in path order. */
  omitted: OmittedSignals[];
}

/**
 * TI15, a new condition in source that compares with a value the tests add; always severity `info` (it never blocks
 * or warns: on the precision corpus 0 of 30 sampled findings were right, see docs/PRECISION.md).
 *
 * The test literals are the eligible string and number literals on the added lines of JavaScript, TypeScript and Python
 * test files. A string is eligible from 6 UTF-16 code units and outside a small stop-list; a number from 4 significant
 * digits. A test file or a source file under a directory named `examples`, `benchmarks`, `bench`, `docs` or `fixtures`
 * is left out. On an added line of a JavaScript, TypeScript or Python source file that is not a test file, an eligible
 * literal is a condition literal when it is next to an equality operator, is the label of a `case`, or (in Python)
 * lies in the bracket group after `in`. A condition literal that also appears on a removed line of the same file is not
 * new. Each new condition literal whose kind and value a test of the same package root adds is one finding at the
 * source path and line (the root is the nearest directory with a `package.json` or `pyproject.toml`, else the first two
 * segments under `packages/` or `apps/` when no manifest is known), whose detail names that location, the literal's
 * kind and length (never its text) and the first same-root test path in code-unit order. The first 10 findings of the
 * change by path, line and detail become signals; the rest are counted per source path in `omitted`. Go and other
 * languages give nothing, on either side.
 */
export function detectTI15(diff: readonly DiffFile[], options: TI15Options): TI15Result {
  const manifests = manifestDirs(diff, options.repoFiles);
  const tests = testLiterals(diff, manifests);
  if (tests.size === 0) return { signals: [], omitted: [] };

  const findings: Array<{ path: string; line: number; detail: string }> = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || file.status === "deleted") continue;
    if (isTestFile(file.path) || inExcludedDir(file.path)) continue;
    const language = coverageSourceLanguage(file.path);
    if (language === null) continue;
    const root = packageRoot(file.path, manifests);

    const removed = new Set<string>();
    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) for (const literal of scanLiterals(entry.text)) removed.add(keyOf(literal));
    }

    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        const seen = new Set<string>();
        for (const literal of conditionLiterals(entry.text, language)) {
          const key = keyOf(literal);
          if (seen.has(key)) continue;
          seen.add(key);
          if (removed.has(key)) continue;
          const testPath = tests.get(key)?.get(root);
          if (testPath === undefined) continue;
          findings.push({
            path: file.path,
            line: entry.line,
            detail: detailOf(literal, file.path, entry.line, testPath),
          });
        }
      }
    }
  }
  findings.sort((a, b) => byCodeUnit(a.path, b.path) || a.line - b.line || byCodeUnit(a.detail, b.detail));
  const signals: TestIntegritySignal[] = findings
    .slice(0, MAX_PER_CHANGE)
    .map(({ path, line, detail }) => ({ id: "TI15", severity: "info", path, line, detail }));
  const counts = new Map<string, number>();
  for (const { path } of findings.slice(MAX_PER_CHANGE)) counts.set(path, (counts.get(path) ?? 0) + 1);
  const omitted: OmittedSignals[] = [...counts].map(([path, count]) => ({ id: "TI15", path, count }));
  return { signals, omitted };
}
