import type { DiffFile, DiffHunk, DiffLineText } from "../diff/unified.js";
import { isBlank, skipBlanks } from "./alwaysTrue.js";

/**
 * The wildcard-in-place-of-an-expected-value scanner behind TI17. A line is an equality line of its language, and its
 * expected side is a wildcard when it is exactly the wildcard form:
 *
 * - JavaScript and TypeScript: the first of `.toBe(`, `.toEqual(` and `.toStrictEqual(` on the line is followed by
 *   blanks, `expect.anything()`, blanks and `)`. That is an O(1) check after the opener, so a wildcard nested in an
 *   object (`{ id: expect.anything() }`) and a call matcher (`toHaveBeenCalledWith`) never qualify.
 * - Python: `assert <a> == <b>` (the first top-level `==`) or `assertEqual(<a>, <b>)` has `<b>` equal to `ANY`,
 *   `mock.ANY` or `unittest.mock.ANY`, by name (no import is checked).
 *
 * Per hunk, an added wildcard line first cancels a removed wildcard line with the same normalized text (a move or a
 * re-indent), then each remaining added wildcard line consumes one removed equality line of the hunk whose expected
 * side is not a wildcard: a consumed added line is a finding. A wildcard that replaces nothing, or whose replaced line
 * is in another hunk, is not reported. Every pass reads each line left to right once, so the time is linear.
 */

/** The most characters of a kept line that are read (the diff reader already cuts lines at 400). */
const MAX_LINE = 400;

const JS_OPENERS = [".toBe(", ".toEqual(", ".toStrictEqual("] as const;
const JS_WILDCARD = ["expect", "anything()"].join(".");
const PY_WILDCARDS: ReadonlySet<string> = new Set(["ANY", "mock.ANY", "unittest.mock.ANY"]);

interface Equality {
  wildcard: boolean;
}

/** An equality line of a JavaScript or TypeScript test: the first opener on the line, and whether its argument is the wildcard. */
function jsEquality(text: string): Equality | null {
  let at = -1;
  let width = 0;
  for (const opener of JS_OPENERS) {
    const found = text.indexOf(opener);
    if (found !== -1 && (at === -1 || found < at)) {
      at = found;
      width = opener.length;
    }
  }
  if (at === -1) return null;
  let i = skipBlanks(text, at + width);
  if (!text.startsWith(JS_WILDCARD, i)) return { wildcard: false };
  i = skipBlanks(text, i + JS_WILDCARD.length);
  return { wildcard: text.charAt(i) === ")" };
}

/**
 * The text of the second operand: from `from`, read to the first top-level stop (`,` or `#`; also `)` when
 * `closeStops`), with quotes and brackets tracked. Trimmed.
 */
function operandFrom(text: string, from: number, closeStops: boolean): string {
  let depth = 0;
  let quote = "";
  let end = text.length;
  for (let i = from; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== "") {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0 && closeStops) {
        end = i;
        break;
      }
      depth--;
    } else if (depth === 0 && (c === "," || c === "#")) {
      end = i;
      break;
    }
  }
  return text.slice(from, end).trim();
}

/** The index of the first top-level `==` at or after `from` (quotes and brackets tracked), or -1. */
function topLevelEquals(text: string, from: number): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== "") {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "#" && depth <= 0) return -1;
    else if (c === "=" && depth === 0 && text.charAt(i + 1) === "=") {
      const before = i === 0 ? "" : text.charAt(i - 1);
      if (before !== "!" && before !== "<" && before !== ">" && before !== "=") return i;
      i++;
    }
  }
  return -1;
}

/** The index just after the top-level comma that ends the first argument of the call whose `(` is at `open`, or -1. */
function secondArgument(text: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open + 1; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== "") {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return -1;
      depth--;
    } else if (c === "," && depth === 0) return i + 1;
  }
  return -1;
}

/** An equality line of a Python test: an `assert a == b` or an `assertEqual(a, b)` line, and whether `b` is the wildcard. */
function pyEquality(text: string): Equality | null {
  const start = skipBlanks(text, 0);
  if (text.startsWith("assert", start) && isBlank(text.charAt(start + 6))) {
    const equals = topLevelEquals(text, start + 6);
    if (equals === -1) return null;
    return { wildcard: PY_WILDCARDS.has(operandFrom(text, equals + 2, false)) };
  }
  const form = "assertEqual(";
  const at = text.indexOf(form);
  if (at === -1) return null;
  const second = secondArgument(text, at + form.length - 1);
  if (second === -1) return null;
  return { wildcard: PY_WILDCARDS.has(operandFrom(text, second, true)) };
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

function equalityOf(entry: DiffLineText, language: "jsts" | "python"): Equality | null {
  const text = entry.text.length > MAX_LINE ? entry.text.slice(0, MAX_LINE) : entry.text;
  return language === "jsts" ? jsEquality(text) : pyEquality(text);
}

function hunkFindings(hunk: DiffHunk, language: "jsts" | "python", out: number[]): void {
  const wildcards: DiffLineText[] = [];
  for (const entry of hunk.added) if (equalityOf(entry, language)?.wildcard === true) wildcards.push(entry);
  if (wildcards.length === 0) return;

  const removedWildcards = new Map<string, number>();
  let replaceable = 0;
  for (const entry of hunk.removed) {
    const equality = equalityOf(entry, language);
    if (equality === null) continue;
    if (equality.wildcard) {
      const key = normalize(entry.text);
      removedWildcards.set(key, (removedWildcards.get(key) ?? 0) + 1);
    } else replaceable++;
  }
  for (const entry of wildcards) {
    const key = normalize(entry.text);
    const left = removedWildcards.get(key) ?? 0;
    if (left > 0) {
      removedWildcards.set(key, left - 1);
      continue;
    }
    if (replaceable > 0) {
      replaceable--;
      out.push(entry.line);
    }
  }
}

/**
 * The lines, ascending and distinct, of the added equality lines of a test file whose expected value is a wildcard that
 * replaces an equality line the same hunk removes.
 */
export function wildcardReplacementLines(file: DiffFile, language: "jsts" | "python"): number[] {
  const out: number[] = [];
  for (const hunk of file.hunks ?? []) hunkFindings(hunk, language, out);
  return out.sort((a, b) => a - b);
}
