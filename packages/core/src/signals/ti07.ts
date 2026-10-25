import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { MAX_TEST_BODY_CHARS, type TestBlock } from "../testIndex/types.js";
import { isTestConfigFile } from "../testSources.js";
import { coverageSourceLanguage } from "./signalFiles.js";
import type { TestMatch } from "./testMatch.js";
import { expectedValueEditedDetail, fullTestName } from "./testName.js";

/** A token of a normalized test body. `lit` is a literal; `value` is what two literals are compared by. */
interface Token {
  kind: "lit" | "word" | "punct" | "opaque";
  text: string;
  value: string;
}

/** The JavaScript and TypeScript matchers whose every argument is an expected value (`expect(x).toBe(…)`). */
const JS_MATCHERS: ReadonlySet<string> = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toMatchObject",
  "toHaveLength",
  "toContain",
  "toContainEqual",
  "toMatch",
  "toBeCloseTo",
  "toHaveProperty",
  "toThrow",
  "toThrowError",
  "toHaveBeenCalledWith",
  "toHaveBeenLastCalledWith",
  "toHaveBeenNthCalledWith",
  "toHaveReturnedWith",
  "toHaveLastReturnedWith",
  "toHaveNthReturnedWith",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "equal",
  "equals",
  "eql",
]);

/** The `assert.<name>(actual, expected)` functions of node:assert: the arguments after the first are expected values. */
const NODE_ASSERT: ReadonlySet<string> = new Set([
  "equal",
  "strictEqual",
  "deepEqual",
  "deepStrictEqual",
  "notEqual",
  "notStrictEqual",
  "notDeepEqual",
  "notDeepStrictEqual",
  "match",
]);

/** The unittest `self.<name>(first, second)` methods: the arguments after the first are expected values. */
const UNITTEST: ReadonlySet<string> = new Set([
  "assertEqual",
  "assertEquals",
  "assertNotEqual",
  "assertAlmostEqual",
  "assertNotAlmostEqual",
  "assertDictEqual",
  "assertListEqual",
  "assertTupleEqual",
  "assertSetEqual",
  "assertSequenceEqual",
  "assertMultiLineEqual",
  "assertCountEqual",
  "assertGreater",
  "assertGreaterEqual",
  "assertLess",
  "assertLessEqual",
  "assertRegex",
]);

const JS_KEYWORD_LITERALS: ReadonlySet<string> = new Set(["true", "false", "null", "undefined"]);
const PY_KEYWORD_LITERALS: ReadonlySet<string> = new Set(["True", "False", "None"]);

const NUMBER = /^(?:0[xXoObB][0-9a-fA-F_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[njJ]?)/;
const WORD = /^[A-Za-z_$][\w$]*/;
/** After these punctuation tokens (or at the start), a `/` starts a regular expression literal in JavaScript. */
const REGEX_BEFORE = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
]);

/** The end (exclusive) of a quoted string that starts at `start` with `quote` (one or three characters), or the text end. */
function stringEnd(body: string, start: number, quote: string): number {
  let i = start + quote.length;
  while (i < body.length) {
    if (body[i] === "\\") {
      i += 2;
      continue;
    }
    if (body.startsWith(quote, i)) return i + quote.length;
    i++;
  }
  return body.length;
}

/** The end (exclusive) of a template literal at `start`, and whether it holds a substitution. */
function templateEnd(body: string, start: number): { end: number; substitution: boolean } {
  let i = start + 1;
  let substitution = false;
  while (i < body.length) {
    const c = body[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return { end: i + 1, substitution };
    if (c === "$" && body[i + 1] === "{") {
      substitution = true;
      let depth = 1;
      i += 2;
      while (i < body.length && depth > 0) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}") depth--;
        else if (body[i] === "`") i = templateEnd(body, i).end - 1;
        else if (body[i] === "'" || body[i] === '"') i = stringEnd(body, i, body[i] as string) - 1;
        i++;
      }
      continue;
    }
    i++;
  }
  return { end: body.length, substitution };
}

/** The end (exclusive) of a regular expression literal at `start`, flags included. */
function regexEnd(body: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < body.length) {
    const c = body[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i++;
      while (i < body.length && /[a-z]/.test(body[i] as string)) i++;
      return i;
    }
    i++;
  }
  return body.length;
}

/** The end (exclusive) of the comment that starts at `start` in JavaScript (`//` or `/*`), or -1 when none starts there. */
function jsCommentEnd(body: string, start: number): number {
  if (body[start] !== "/") return -1;
  if (body[start + 1] === "/") {
    const newline = body.indexOf("\n", start);
    return newline === -1 ? body.length : newline;
  }
  if (body[start + 1] === "*") {
    const close = body.indexOf("*/", start + 2);
    return close === -1 ? body.length : close + 2;
  }
  return -1;
}

/** The tokens of a JavaScript or TypeScript test body. */
function lexJs(body: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // A comment is read before anything else, so an apostrophe or a slash in it cannot open a string or a regex.
    const comment = jsCommentEnd(body, i);
    if (comment !== -1) {
      const text = body.slice(i, comment);
      out.push({ kind: "opaque", text, value: text });
      i = comment;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = stringEnd(body, i, c);
      const text = body.slice(i, end);
      out.push({ kind: "lit", text, value: `s:${text.slice(1, -1)}` });
      i = end;
      continue;
    }
    if (c === "`") {
      const { end, substitution } = templateEnd(body, i);
      const text = body.slice(i, end);
      out.push(
        substitution ? { kind: "opaque", text, value: text } : { kind: "lit", text, value: `s:${text.slice(1, -1)}` },
      );
      i = end;
      continue;
    }
    const previous = out[out.length - 1];
    if (c === "/" && (previous === undefined || (previous.kind === "punct" && REGEX_BEFORE.has(previous.text)))) {
      const end = regexEnd(body, i);
      const text = body.slice(i, end);
      out.push({ kind: "lit", text, value: `r:${text}` });
      i = end;
      continue;
    }
    const rest = body.slice(i, i + 64);
    const number = /^[\d.]/.test(c) ? NUMBER.exec(rest) : null;
    if (number !== null && number[0] !== ".") {
      out.push({ kind: "lit", text: number[0], value: `n:${number[0].replace(/_/g, "").toLowerCase()}` });
      i += number[0].length;
      continue;
    }
    const word = WORD.exec(body.slice(i, i + 256));
    if (word !== null) {
      // A word longer than the probe is read on: the rest of its characters are word characters too.
      let end = i + word[0].length;
      while (end < body.length && /[\w$]/.test(body[end] as string)) end++;
      const text = body.slice(i, end);
      out.push(
        JS_KEYWORD_LITERALS.has(text) ? { kind: "lit", text, value: `k:${text}` } : { kind: "word", text, value: text },
      );
      i = end;
      continue;
    }
    out.push({ kind: "punct", text: c, value: c });
    i++;
  }
  return out;
}

const PY_STRING_PREFIX = /^[rRbBuUfF]{1,2}(?=['"])/;

/** The tokens of a Python test body. `==` is one token. */
function lexPy(body: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") {
      const newline = body.indexOf("\n", i);
      const end = newline === -1 ? body.length : newline;
      const text = body.slice(i, end);
      out.push({ kind: "opaque", text, value: text });
      i = end;
      continue;
    }
    const prefix = PY_STRING_PREFIX.exec(body.slice(i, i + 3))?.[0] ?? "";
    const q = body[i + prefix.length];
    if (q === "'" || q === '"') {
      const quoteAt = i + prefix.length;
      const quote = body.startsWith(q.repeat(3), quoteAt) ? q.repeat(3) : q;
      const end = stringEnd(body, quoteAt, quote);
      const text = body.slice(i, end);
      const lower = prefix.toLowerCase();
      if (lower.includes("f")) out.push({ kind: "opaque", text, value: text });
      else {
        const inner = body.slice(quoteAt + quote.length, Math.max(quoteAt + quote.length, end - quote.length));
        out.push({ kind: "lit", text, value: `s:${lower.replace("u", "")}:${inner}` });
      }
      i = end;
      continue;
    }
    const rest = body.slice(i, i + 64);
    const number = /^[\d.]/.test(c) ? NUMBER.exec(rest) : null;
    if (number !== null && number[0] !== ".") {
      out.push({ kind: "lit", text: number[0], value: `n:${number[0].replace(/_/g, "").toLowerCase()}` });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_]\w*/.exec(body.slice(i, i + 256));
    if (word !== null) {
      let end = i + word[0].length;
      while (end < body.length && /\w/.test(body[end] as string)) end++;
      const text = body.slice(i, end);
      out.push(
        PY_KEYWORD_LITERALS.has(text) ? { kind: "lit", text, value: `k:${text}` } : { kind: "word", text, value: text },
      );
      i = end;
      continue;
    }
    if (c === "=" && body[i + 1] === "=") {
      out.push({ kind: "punct", text: "==", value: "==" });
      i += 2;
      continue;
    }
    out.push({ kind: "punct", text: c, value: c });
    i++;
  }
  return out;
}

const OPEN: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/** The index of the token that closes the bracket at `open`, or -1. */
function closeOf(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.kind !== "punct") continue;
    if (OPEN[t.text] !== undefined) depth++;
    else if (t.text === ")" || t.text === "]" || t.text === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The index after the first top-level comma inside the brackets `open`…`close`, or -1 when there is none. */
function afterFirstComma(tokens: readonly Token[], open: number, close: number): number {
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const t = tokens[i] as Token;
    if (t.kind !== "punct") continue;
    if (OPEN[t.text] !== undefined) depth++;
    else if (t.text === ")" || t.text === "]" || t.text === "}") depth--;
    else if (t.text === "," && depth === 0) return i + 1;
  }
  return -1;
}

/** One stretch of tokens that holds expected values, and the assertion it belongs to. */
interface Region {
  start: number;
  end: number;
  matcher: string;
}

/** The end (exclusive) of the Python operand that starts at `at`: a literal, a bracket group, or a dotted name with calls. */
function pyOperandEnd(tokens: readonly Token[], at: number): number {
  let i = at;
  if (tokens[i]?.text === "-" && tokens[i]?.kind === "punct") i++;
  const first = tokens[i];
  if (first === undefined) return at;
  if (first.kind === "lit") return i + 1;
  if (first.kind === "punct" && OPEN[first.text] !== undefined) {
    const close = closeOf(tokens, i);
    return close === -1 ? at : close + 1;
  }
  if (first.kind !== "word") return at;
  i++;
  for (;;) {
    const t = tokens[i];
    if (t?.kind === "punct" && t.text === "." && tokens[i + 1]?.kind === "word") {
      i += 2;
      continue;
    }
    if (t?.kind === "punct" && (t.text === "(" || t.text === "[")) {
      const close = closeOf(tokens, i);
      if (close === -1) return at;
      i = close + 1;
      continue;
    }
    return i;
  }
}

/** The regions of a body's tokens that hold the expected values of its assertions. */
function regionsOf(tokens: readonly Token[], language: "js" | "py"): Region[] {
  const regions: Region[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.kind !== "word") continue;
    const dotBefore = tokens[i - 1]?.kind === "punct" && tokens[i - 1]?.text === ".";
    const open = tokens[i + 1]?.kind === "punct" && tokens[i + 1]?.text === "(" ? i + 1 : -1;
    if (language === "js") {
      if (!dotBefore || open === -1) continue;
      const close = closeOf(tokens, open);
      if (close === -1) continue;
      if (tokens[i - 2]?.text === "assert" && tokens[i - 3]?.text !== ".") {
        if (!NODE_ASSERT.has(t.text)) continue;
        const from = afterFirstComma(tokens, open, close);
        if (from !== -1) regions.push({ start: from, end: close, matcher: `assert.${t.text}` });
      } else if (JS_MATCHERS.has(t.text)) {
        regions.push({ start: open + 1, end: close, matcher: t.text });
      }
      continue;
    }
    if (dotBefore && open !== -1 && UNITTEST.has(t.text)) {
      const close = closeOf(tokens, open);
      if (close === -1) continue;
      const from = afterFirstComma(tokens, open, close);
      if (from !== -1) regions.push({ start: from, end: close, matcher: t.text });
      continue;
    }
    if (!dotBefore && t.text === "assert") {
      // `assert <actual> == <expected>`: the first operand after a top-level `==`, before a comma or the next assert.
      let depth = 0;
      for (let j = i + 1; j < tokens.length; j++) {
        const u = tokens[j] as Token;
        if (u.kind === "word" && u.text === "assert" && depth === 0) break;
        if (u.kind !== "punct") continue;
        if (OPEN[u.text] !== undefined) depth++;
        else if (u.text === ")" || u.text === "]" || u.text === "}") {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && u.text === ",") break;
        else if (depth === 0 && u.text === "==") {
          const end = pyOperandEnd(tokens, j + 1);
          if (end > j + 1) regions.push({ start: j + 1, end, matcher: "assert ==" });
          break;
        }
      }
    }
  }
  return regions;
}

/** A body with the literals of its expected values taken out: the rest as keys, and the literals with their matcher. */
interface Masked {
  keys: string[];
  literals: { value: string; matcher: string }[];
}

const AFTER_OPERAND_START = new Set(["(", "[", "{", ",", ":", "=="]);

function mask(body: string, language: "js" | "py"): Masked {
  const tokens = language === "py" ? lexPy(body) : lexJs(body);
  const owner = new Array<string | null>(tokens.length).fill(null);
  for (const region of regionsOf(tokens, language)) {
    for (let i = region.start; i < region.end; i++) owner[i] ??= region.matcher;
  }
  const keys: string[] = [];
  const literals: { value: string; matcher: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const matcher = owner[i];
    if (matcher !== null && matcher !== undefined) {
      const next = tokens[i + 1];
      const previous = tokens[i - 1];
      // A minus sign before a number at the start of an operand belongs to the number: `5` → `-5` is a literal edit.
      if (
        t.kind === "punct" &&
        t.text === "-" &&
        next?.kind === "lit" &&
        next.value.startsWith("n:") &&
        owner[i + 1] === matcher &&
        (previous === undefined || owner[i - 1] !== matcher || AFTER_OPERAND_START.has(previous.text))
      ) {
        keys.push("\u0000lit");
        literals.push({ value: `n:-${next.value.slice(2)}`, matcher });
        i++;
        continue;
      }
      if (t.kind === "lit") {
        keys.push("\u0000lit");
        literals.push({ value: t.value, matcher });
        continue;
      }
    }
    keys.push(`${t.kind}:${t.text}`);
  }
  return { keys, literals };
}

/** The matcher of the first expected value that differs, when the two bodies differ only in such values; else null. */
function editedMatcher(base: TestBlock, head: TestBlock, language: "js" | "py"): string | null {
  if (base.body === head.body) return null;
  if (base.body.length >= MAX_TEST_BODY_CHARS || head.body.length >= MAX_TEST_BODY_CHARS) return null;
  const a = mask(base.body, language);
  const b = mask(head.body, language);
  if (a.keys.length !== b.keys.length || a.literals.length !== b.literals.length) return null;
  for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return null;
  for (let i = 0; i < a.literals.length; i++) {
    const x = a.literals[i] as { value: string; matcher: string };
    const y = b.literals[i] as { value: string; matcher: string };
    if (x.matcher !== y.matcher) return null;
  }
  const changed = a.literals.findIndex((x, i) => x.value !== (b.literals[i] as { value: string }).value);
  return changed === -1 ? null : (a.literals[changed] as { matcher: string }).matcher;
}

/**
 * Whether the diff changes a source file: a JavaScript, TypeScript or Python file (by extension) that is not a test
 * file or a test-config file, added, modified or renamed (judged by its new path). A deleted file does not count.
 */
export function changesSource(diff: readonly DiffFile[]): boolean {
  return diff.some(
    (file) =>
      file.status !== "deleted" &&
      coverageSourceLanguage(file.path) !== null &&
      !isTestFile(file.path) &&
      !isTestConfigFile(file.path),
  );
}

/**
 * TI07, an expected value edited to match. Reads the matched pairs. A pair counts when the head body is the base body
 * with only literals inside the expected-value arguments of assertions changed (the arguments of `toBe(…)`,
 * `toEqual(…)` and the other matchers, the arguments after the first of node:assert's `assert.equal(…)` family and of
 * unittest's `assertEqual(…)` family, and the operand after `==` in a Python `assert`), at least one of them differs,
 * and the diff also changes a source file. One `warn` finding per test, at the head path and line, in modes block and
 * warn. The detail names the matcher, never the literal.
 */
export function detectTI07(match: Pick<TestMatch, "pairs">, diff: readonly DiffFile[]): TestIntegritySignal[] {
  if (!changesSource(diff)) return [];
  const found: TestIntegritySignal[] = [];
  for (const { headPath, base, head } of match.pairs) {
    const language = coverageSourceLanguage(headPath) === "python" ? "py" : "js";
    const matcher = editedMatcher(base, head, language);
    if (matcher === null) continue;
    found.push({
      id: "TI07",
      severity: "warn",
      path: headPath,
      line: head.line,
      detail: expectedValueEditedDetail(fullTestName(head), matcher),
    });
  }
  return found;
}
