import type { DiffFile, DiffLineText } from "../diff/unified.js";

/**
 * The always-true matcher (JavaScript and TypeScript) and always-true helper (Python) scanners behind TI17. Each reads
 * only the kept added lines of one test file (the diff reader cuts a file at 5000 lines and a line at 400 characters),
 * left to right with no backtracking and no regular expression with a nested quantifier, so the time is linear in the
 * text. A definition that is not on added lines, or whose added lines are not consecutive, is not read: that is a named
 * miss (docs/LIMITS.md).
 */

/** The most always-true names (matchers or helpers) one file records; later definitions are not read. */
export const MAX_ALWAYS_TRUE_NAMES = 50;

export const isBlank = (c: string): boolean => c === " " || c === "\t";
export const isWordChar = (c: string): boolean =>
  (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_" || c === "$";
const isWordStart = (c: string): boolean => isWordChar(c) && !(c >= "0" && c <= "9");

export function skipBlanks(text: string, from: number): number {
  let i = from;
  while (i < text.length && isBlank(text.charAt(i))) i++;
  return i;
}

/** The index just after the word that starts at `from` (equal to `from` when none starts there). */
export function wordEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && isWordChar(text.charAt(i))) i++;
  return i;
}

/** The kept added lines of a file, ascending by line number. */
export function addedLinesOf(file: DiffFile): DiffLineText[] {
  const lines: DiffLineText[] = [];
  for (const hunk of file.hunks ?? []) for (const entry of hunk.added) lines.push(entry);
  return lines.sort((a, b) => a.line - b.line);
}

/** The index just after the closing bracket that matches the opener at `open` (quotes skipped), or -1 on this line. */
export function matchingClose(text: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== "") {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// JavaScript and TypeScript: a matcher added to `expect` whose every `pass` is the constant true, and its calls.

/** The call that opens a matcher definition. Built from parts so this file holds the call only as data. */
const EXTEND_CALL = ["expect", "extend("].join(".");

interface MatcherScan {
  /** Matcher name to whether every `pass` of every definition of it is the constant true. */
  names: Map<string, boolean>;
  /** The kept lines each definition read ran over, as inclusive `[first, last]` line numbers. */
  spans: Array<[number, number]>;
}

/** One definition's state while it is read across consecutive added lines. */
interface Open {
  depth: number;
  inObject: boolean;
  expectKey: boolean;
  quote: string;
  inBlock: boolean;
  /** The key whose span the reader is in, when the key is one that can hold a matcher. */
  current: { name: string; passes: number; trues: number } | null;
}

/** Whether the value of a `pass` property that starts at `at` (just after the colon and blanks) is the constant true. */
function isTrueValue(text: string, at: number): boolean {
  if (!text.startsWith("true", at)) return false;
  const after = at + 4;
  if (after < text.length && isWordChar(text.charAt(after))) return false;
  const next = skipBlanks(text, after);
  if (next >= text.length) return true;
  const c = text.charAt(next);
  return c === "," || c === "}" || c === ")" || c === "]" || c === ";" || c === "/";
}

/**
 * Reads one line of an open definition from `from`. Returns the column just after the end of the definition when it
 * closes on this line, or -1 when it stays open.
 */
function readLine(text: string, from: number, state: Open, found: Map<string, boolean>): number {
  let i = from;
  while (i < text.length) {
    const c = text.charAt(i);
    if (state.inBlock) {
      if (c === "*" && text.charAt(i + 1) === "/") {
        state.inBlock = false;
        i += 2;
      } else i++;
      continue;
    }
    if (state.quote !== "") {
      if (c === "\\") i += 2;
      else {
        if (c === state.quote) state.quote = "";
        i++;
      }
      continue;
    }
    if (c === "/" && text.charAt(i + 1) === "/") return -1;
    if (c === "/" && text.charAt(i + 1) === "*") {
      state.inBlock = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      state.quote = c;
      state.expectKey = false;
      i++;
      continue;
    }
    if (isBlank(c)) {
      i++;
      continue;
    }
    if (isWordChar(c)) {
      const end = wordEnd(text, i);
      const word = text.slice(i, end);
      const afterDot = i > 0 && text.charAt(i - 1) === ".";
      i = end;
      if (state.inObject && state.depth === 1 && state.expectKey && isWordStart(c)) {
        let name = word;
        if (word === "async") {
          const next = skipBlanks(text, i);
          if (next < text.length && isWordStart(text.charAt(next))) {
            const nextEnd = wordEnd(text, next);
            name = text.slice(next, nextEnd);
            i = nextEnd;
          }
        }
        const after = skipBlanks(text, i);
        state.expectKey = false;
        const sep = text.charAt(after);
        state.current = null;
        if (sep === ":" || sep === "(") {
          if (found.has(name) || found.size < MAX_ALWAYS_TRUE_NAMES) {
            state.current = { name, passes: 0, trues: 0 };
            if (!found.has(name)) found.set(name, true);
          }
        }
        continue;
      }
      if (state.current !== null && word === "pass" && !afterDot) {
        state.current.passes++;
        const colon = skipBlanks(text, i);
        if (text.charAt(colon) === ":" && text.charAt(colon + 1) !== ":") {
          if (isTrueValue(text, skipBlanks(text, colon + 1))) state.current.trues++;
        }
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      if (c === "{" && state.depth === 0 && !state.inObject) {
        state.inObject = true;
        state.expectKey = true;
      } else if (state.expectKey && state.depth === 1) state.expectKey = false;
      state.depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      state.depth--;
      i++;
      if (state.inObject && state.depth === 0) {
        endSpan(state, found);
        return i;
      }
      if (state.depth < 0) {
        endSpan(state, found);
        return i;
      }
      continue;
    }
    if (c === "," && state.inObject && state.depth === 1) {
      endSpan(state, found);
      state.expectKey = true;
      i++;
      continue;
    }
    if (c !== "." && state.expectKey && state.depth === 1) state.expectKey = false;
    i++;
  }
  return -1;
}

/** Closes the key span the reader is in: its matcher stays always-true only when it has a `pass` and all are true. */
function endSpan(state: Open, found: Map<string, boolean>): void {
  const current = state.current;
  state.current = null;
  if (current === null) return;
  const alwaysTrue = current.passes > 0 && current.trues === current.passes;
  if (!alwaysTrue) found.set(current.name, false);
}

/** Reads the definitions in `lines` (ascending), each over consecutive added lines. */
function scanMatchers(lines: DiffLineText[]): MatcherScan {
  const names = new Map<string, boolean>();
  const spans: Array<[number, number]> = [];
  let i = 0;
  let col = 0;
  while (i < lines.length) {
    const entry = lines[i] as DiffLineText;
    const open = entry.text.indexOf(EXTEND_CALL, col);
    if (open === -1) {
      i++;
      col = 0;
      continue;
    }
    const state: Open = {
      depth: 0,
      inObject: false,
      expectKey: false,
      quote: "",
      inBlock: false,
      current: null,
    };
    const found = new Map<string, boolean>();
    let at = i;
    let from = open + EXTEND_CALL.length;
    let closedAt = -1;
    for (;;) {
      const line = lines[at] as DiffLineText;
      closedAt = readLine(line.text, from, state, found);
      if (closedAt !== -1) break;
      state.quote = state.quote === "`" ? "`" : "";
      const next = lines[at + 1];
      if (next === undefined || next.line !== line.line + 1) break;
      at++;
      from = 0;
    }
    spans.push([entry.line, (lines[at] as DiffLineText).line]);
    if (closedAt === -1) {
      // Abandoned at a gap or the end of the file: nothing the definition said is used.
      i = at + 1;
      col = 0;
      continue;
    }
    for (const [name, value] of found) {
      // A name defined twice is always-true only when every definition of it is.
      const earlier = names.get(name);
      if (names.size < MAX_ALWAYS_TRUE_NAMES || earlier !== undefined)
        names.set(name, earlier === undefined ? value : earlier && value);
    }
    i = at;
    col = closedAt;
  }
  return { names, spans };
}

/** Whether the line holds a call `.name(` of an always-true matcher name. */
function callsAnyOf(text: string, names: Map<string, boolean>): boolean {
  for (let i = text.indexOf("."); i !== -1; i = text.indexOf(".", i + 1)) {
    const start = i + 1;
    if (start >= text.length || !isWordStart(text.charAt(start))) continue;
    const end = wordEnd(text, start);
    if (names.get(text.slice(start, end)) !== true) continue;
    if (text.charAt(skipBlanks(text, end)) === "(") return true;
  }
  return false;
}

/**
 * The lines, ascending and distinct, of the added assertions in a JavaScript or TypeScript test file that call a matcher
 * the same diff adds to `expect` and whose every `pass` is the constant true. A definition is read only over consecutive
 * added lines; a call is read on added lines outside every definition.
 */
export function alwaysTrueMatcherLines(file: DiffFile): number[] {
  const lines = addedLinesOf(file);
  const { names, spans } = scanMatchers(lines);
  let any = false;
  for (const value of names.values()) if (value) any = true;
  if (!any) return [];
  const out: number[] = [];
  let span = 0;
  for (const entry of lines) {
    while (span < spans.length && (spans[span] as [number, number])[1] < entry.line) span++;
    const here = spans[span];
    if (here !== undefined && entry.line >= here[0] && entry.line <= here[1]) continue;
    if (callsAnyOf(entry.text, names)) out.push(entry.line);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Python: a helper whose every return is True, and the assertions that are exactly a call to it.

/** The width of the leading white space of a line (a tab counts to the next multiple of 8). */
export function indentOf(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === " ") width++;
    else if (c === "\t") width += 8 - (width % 8);
    else break;
  }
  return width;
}

const isEmptyLine = (text: string): boolean => skipBlanks(text, 0) >= text.length;

/** Whether `text` has `word` as a whole word anywhere (quotes are not read, so a string that holds it also counts). */
function hasWord(text: string, word: string): boolean {
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + 1)) {
    const before = i === 0 ? "" : text.charAt(i - 1);
    const after = text.charAt(i + word.length);
    if ((before === "" || !isWordChar(before)) && (after === "" || !isWordChar(after))) return true;
  }
  return false;
}

/** The text after indentation if it starts with `word` followed by a non-word character or the end; else null. */
function afterKeyword(text: string, word: string): number {
  const start = skipBlanks(text, 0);
  if (!text.startsWith(word, start)) return -1;
  const end = start + word.length;
  if (end < text.length && isWordChar(text.charAt(end))) return -1;
  return end;
}

/** The name of a helper whose line (after indentation) is `def <name>(`, or null. */
function defName(text: string): string | null {
  const end = afterKeyword(text, "def");
  if (end === -1 || end >= text.length || !isBlank(text.charAt(end))) return null;
  const start = skipBlanks(text, end);
  const nameEnd = wordEnd(text, start);
  if (nameEnd === start || !isWordStart(text.charAt(start))) return null;
  return text.charAt(skipBlanks(text, nameEnd)) === "(" ? text.slice(start, nameEnd) : null;
}

/** Whether a helper body is always-true: at least one return, all `return True`, and no nested `def`/`class`/`lambda`/`yield`. */
function bodyIsAlwaysTrue(body: DiffLineText[]): boolean {
  let returns = 0;
  let trues = 0;
  for (const entry of body) {
    const text = entry.text;
    if (defName(text) !== null || afterKeyword(text, "def") !== -1 || afterKeyword(text, "async") !== -1) return false;
    if (afterKeyword(text, "class") !== -1 || hasWord(text, "lambda") || hasWord(text, "yield")) return false;
    const end = afterKeyword(text, "return");
    if (end === -1) continue;
    returns++;
    let value = text.slice(end);
    const hash = value.indexOf("#");
    if (hash !== -1) value = value.slice(0, hash);
    if (value.trim() === "True") trues++;
  }
  return returns > 0 && trues === returns;
}

/** The names of the always-true helpers the added lines define, each body read over consecutive added lines. */
function scanHelpers(lines: DiffLineText[]): Set<string> {
  const helpers = new Map<string, boolean>();
  let i = 0;
  while (i < lines.length) {
    const entry = lines[i] as DiffLineText;
    const name = defName(entry.text);
    if (name === null) {
      i++;
      continue;
    }
    const indent = indentOf(entry.text);
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j] as DiffLineText;
      const before = lines[j - 1] as DiffLineText;
      if (line.line !== before.line + 1) break;
      if (!isEmptyLine(line.text) && indentOf(line.text) <= indent) break;
      j++;
    }
    const value = bodyIsAlwaysTrue(lines.slice(i + 1, j));
    const earlier = helpers.get(name);
    if (earlier !== undefined || helpers.size < MAX_ALWAYS_TRUE_NAMES)
      helpers.set(name, earlier === undefined ? value : earlier && value);
    i = j;
  }
  const out = new Set<string>();
  for (const [name, value] of helpers) if (value) out.add(name);
  return out;
}

/** Whether `rest` (the text after a call's closing bracket) leaves the call as the whole condition or the first argument. */
function endsCondition(rest: string): boolean {
  const next = skipBlanks(rest, 0);
  if (next >= rest.length) return true;
  const c = rest.charAt(next);
  return c === "," || c === "#";
}

/** Whether `text` from `at` is `<name>(...)` for an always-true name, closed on this line. Returns the index after it. */
function helperCall(text: string, at: number, helpers: Set<string>): number {
  const start = skipBlanks(text, at);
  if (start >= text.length || !isWordStart(text.charAt(start))) return -1;
  const end = wordEnd(text, start);
  if (!helpers.has(text.slice(start, end))) return -1;
  const open = skipBlanks(text, end);
  if (text.charAt(open) !== "(") return -1;
  return matchingClose(text, open);
}

/**
 * The lines, ascending and distinct, of the added assertions in a Python test file that are exactly a call to a helper
 * the same diff defines and whose every `return` is `True`: `assert helper(...)` as the whole condition (a `, message`
 * or a comment may follow), or `self.assertTrue(helper(...))` with an optional message. A helper inside a larger
 * condition is not a use.
 */
export function alwaysTrueHelperLines(file: DiffFile): number[] {
  const lines = addedLinesOf(file);
  const helpers = scanHelpers(lines);
  if (helpers.size === 0) return [];
  const out: number[] = [];
  for (const entry of lines) {
    const text = entry.text;
    const assertEnd = afterKeyword(text, "assert");
    if (assertEnd !== -1 && assertEnd < text.length && isBlank(text.charAt(assertEnd))) {
      const closed = helperCall(text, assertEnd, helpers);
      if (closed !== -1 && endsCondition(text.slice(closed))) out.push(entry.line);
      continue;
    }
    const start = skipBlanks(text, 0);
    const form = "self.assertTrue(";
    if (!text.startsWith(form, start)) continue;
    const closed = helperCall(text, start + form.length, helpers);
    if (closed === -1) continue;
    const next = skipBlanks(text, closed);
    const c = text.charAt(next);
    if (c === ")" || c === ",") out.push(entry.line);
  }
  return out;
}
