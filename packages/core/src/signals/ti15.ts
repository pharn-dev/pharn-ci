import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { escapeDetailText, quoteLiteral } from "./detailText.js";
import { coverageSourceLanguage } from "./signalFiles.js";
import { testLanguage } from "./testLines.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The most TI15 signals one source file gives; the rest are dropped, keeping the lowest line numbers. */
const MAX_PER_FILE = 20;
/** The longest detail a signal carries. */
const MAX_DETAIL = 300;
/** A string literal needs this many UTF-16 code units, a number this many significant digits. */
const MIN_STRING_LENGTH = 4;
const MIN_SIGNIFICANT_DIGITS = 3;

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

/** The eligible literals of the added lines of the test files, each with the sorted test paths that add it. */
function testLiterals(diff: readonly DiffFile[]): Map<string, string[]> {
  const found = new Map<string, Set<string>>();
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || file.status === "deleted") continue;
    if (!isTestFile(file.path)) continue;
    const language = testLanguage(file.path);
    if (language !== "jsts" && language !== "python") continue;
    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        for (const literal of scanLiterals(entry.text)) {
          if (!isEligible(literal)) continue;
          const key = keyOf(literal);
          const paths = found.get(key) ?? new Set<string>();
          paths.add(file.path);
          found.set(key, paths);
        }
      }
    }
  }
  return new Map([...found].map(([key, paths]) => [key, [...paths].sort(byCodeUnit)]));
}

/** The sentence of a signal; the test path is replaced by a general phrase when the sentence would pass 300 characters. */
function detailOf(literal: string, testPath: string): string {
  const quoted = quoteLiteral(literal);
  const full = `This condition compares with "${quoted}", a value the test file "${escapeDetailText(testPath)}" also adds, so the code may special-case the test's input.`;
  if (full.length <= MAX_DETAIL) return full;
  return `This condition compares with "${quoted}", a value a test file in this change also adds, so the code may special-case the test's input.`;
}

/**
 * TI15, a new condition in source that compares with a value the tests add; always severity `warn`.
 *
 * The test literals are the eligible string and number literals on the added lines of JavaScript, TypeScript and Python
 * test files. A string is eligible from 4 UTF-16 code units and outside a small stop-list; a number from 3 significant
 * digits. On an added line of a JavaScript, TypeScript or Python source file that is not a test file, an eligible
 * literal is a condition literal when it is next to an equality operator, is the label of a `case`, or (in Python)
 * lies in the bracket group after `in`. A condition literal that also appears on a removed line of the same file is not
 * new. Each new condition literal whose kind and value a test adds is one signal at the source path and line, whose
 * detail quotes the literal (cut at 60 characters) and names the first test path in code-unit order. At most 20 per
 * source file, on the lowest lines. Go and other languages give nothing, on either side.
 */
export function detectTI15(diff: readonly DiffFile[]): TestIntegritySignal[] {
  const tests = testLiterals(diff);
  if (tests.size === 0) return [];

  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || file.status === "deleted") continue;
    if (isTestFile(file.path)) continue;
    const language = coverageSourceLanguage(file.path);
    if (language === null) continue;

    const removed = new Set<string>();
    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) for (const literal of scanLiterals(entry.text)) removed.add(keyOf(literal));
    }

    const found: Array<{ line: number; detail: string }> = [];
    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        const seen = new Set<string>();
        for (const literal of conditionLiterals(entry.text, language)) {
          const key = keyOf(literal);
          if (seen.has(key)) continue;
          seen.add(key);
          if (removed.has(key)) continue;
          const testPaths = tests.get(key);
          if (testPaths === undefined) continue;
          found.push({ line: entry.line, detail: detailOf(literal.value, testPaths[0] as string) });
        }
      }
    }
    found.sort((a, b) => a.line - b.line || byCodeUnit(a.detail, b.detail));
    for (const { line, detail } of found.slice(0, MAX_PER_FILE)) {
      signals.push({ id: "TI15", severity: "warn", path: file.path, line, detail });
    }
  }
  return signals.sort(
    (a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.detail, b.detail),
  );
}
