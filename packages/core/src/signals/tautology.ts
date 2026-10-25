/** The longest string literal (quotes included) a tautology may hold; a longer one is not read. Keeps the scan linear. */
const MAX_LITERAL = 200;

export type TautologyLanguage = "js" | "py";

const isWord = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isSpace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13;

function skipSpaces(text: string, at: number): number {
  let i = at;
  while (i < text.length && isSpace(text.charCodeAt(i))) i++;
  return i;
}

/** The index after the digits (with `_`) starting at `at`, or `at` when there is none. */
function digitsEnd(text: string, at: number): number {
  let i = at;
  while (i < text.length && (isDigit(text.charCodeAt(i)) || (i > at && text.charCodeAt(i) === 95))) i++;
  return i;
}

/**
 * The end of the literal at `at`, or -1. A literal is a number (`-` optional, digits, a fraction, an exponent), a string
 * in single or double quotes of at most 200 code units, or one of the words of the language: `true`, `false`, `null`,
 * `undefined` for JavaScript; `True`, `False`, `None` for Python.
 */
function literalEnd(text: string, at: number, language: TautologyLanguage): number {
  if (at >= text.length) return -1;
  const code = text.charCodeAt(at);
  if (code === 39 || code === 34) {
    const limit = Math.min(text.length, at + MAX_LITERAL);
    let i = at + 1;
    while (i < limit) {
      const c = text.charCodeAt(i);
      if (c === 92) i += 2;
      else if (c === code) return i + 1;
      else i++;
    }
    return -1;
  }
  let i = at;
  if (code === 45) i++;
  if (i < text.length && isDigit(text.charCodeAt(i))) {
    i = digitsEnd(text, i);
    if (text.charCodeAt(i) === 46 && isDigit(text.charCodeAt(i + 1))) i = digitsEnd(text, i + 1);
    const e = text.charCodeAt(i);
    if (e === 101 || e === 69) {
      let j = i + 1;
      if (text.charCodeAt(j) === 43 || text.charCodeAt(j) === 45) j++;
      if (isDigit(text.charCodeAt(j))) i = digitsEnd(text, j);
    }
    return i < text.length && isWord(text.charCodeAt(i)) ? -1 : i;
  }
  if (i !== at) return -1;
  const words = language === "js" ? ["true", "false", "null", "undefined"] : ["True", "False", "None"];
  for (const word of words) {
    if (text.startsWith(word, at) && !(at + word.length < text.length && isWord(text.charCodeAt(at + word.length)))) {
      return at + word.length;
    }
  }
  return -1;
}

/** Two literals starting at `a` and `b` (after spaces) with the same text: the end of the second, or -1. */
function sameLiteral(
  text: string,
  first: number,
  afterSeparator: (end: number) => number,
  language: TautologyLanguage,
): number {
  const firstEnd = literalEnd(text, first, language);
  if (firstEnd === -1) return -1;
  const secondStart = afterSeparator(firstEnd);
  if (secondStart === -1) return -1;
  const secondEnd = literalEnd(text, secondStart, language);
  if (secondEnd === -1) return -1;
  return text.slice(first, firstEnd) === text.slice(secondStart, secondEnd) ? secondEnd : -1;
}

/** Whether `at` is the start of a name: the character before it is not part of an identifier. */
const atBoundary = (text: string, at: number): boolean => at === 0 || !isWord(text.charCodeAt(at - 1));

/** The index after `token` (after optional spaces) at `at`, or -1. */
function expectToken(text: string, at: number, token: string): number {
  const i = skipSpaces(text, at);
  return text.startsWith(token, i) ? i + token.length : -1;
}

const JS_EXPECT_MATCHERS = ["toBe", "toEqual", "toStrictEqual"] as const;
const JS_ASSERT_EQUALS = ["equal", "strictEqual", "deepEqual", "deepStrictEqual"] as const;

/** `expect(L).toBe|toEqual|toStrictEqual(L)` with the same literal text, not negated, starting at the `expect(` at `p`. */
function jsExpect(text: string, p: number): boolean {
  let i = skipSpaces(text, p + "expect(".length);
  const firstEnd = literalEnd(text, i, "js");
  if (firstEnd === -1) return false;
  const first = text.slice(i, firstEnd);
  i = expectToken(text, firstEnd, ")");
  if (i === -1) return false;
  i = expectToken(text, i, ".");
  if (i === -1) return false;
  i = skipSpaces(text, i);
  for (const matcher of JS_EXPECT_MATCHERS) {
    if (!text.startsWith(matcher, i)) continue;
    const afterName = expectToken(text, i + matcher.length, "(");
    if (afterName === -1) continue;
    const start = skipSpaces(text, afterName);
    const secondEnd = literalEnd(text, start, "js");
    if (secondEnd === -1 || text.slice(start, secondEnd) !== first) continue;
    return expectToken(text, secondEnd, ")") !== -1;
  }
  return false;
}

/** `assert(true)`, `assert.ok(true)` or `assert.<equal…>(L, L)` starting at the `assert` at `p`. */
function jsAssert(text: string, p: number): boolean {
  const i = p + "assert".length;
  const open = expectToken(text, i, "(");
  if (open !== -1) return jsTrueCall(text, open);
  const dot = expectToken(text, i, ".");
  if (dot === -1) return false;
  const nameAt = skipSpaces(text, dot);
  if (text.startsWith("ok", nameAt)) {
    const afterOk = expectToken(text, nameAt + 2, "(");
    return afterOk !== -1 && jsTrueCall(text, afterOk);
  }
  for (const name of JS_ASSERT_EQUALS) {
    if (!text.startsWith(name, nameAt)) continue;
    const afterName = expectToken(text, nameAt + name.length, "(");
    if (afterName === -1) continue;
    const end = sameLiteral(
      text,
      skipSpaces(text, afterName),
      (e) => {
        const comma = expectToken(text, e, ",");
        return comma === -1 ? -1 : skipSpaces(text, comma);
      },
      "js",
    );
    return end !== -1 && expectToken(text, end, ")") !== -1;
  }
  return false;
}

function jsTrueCall(text: string, afterOpen: number): boolean {
  const start = skipSpaces(text, afterOpen);
  if (!text.startsWith("true", start)) return false;
  const end = start + 4;
  if (end < text.length && isWord(text.charCodeAt(end))) return false;
  return expectToken(text, end, ")") !== -1;
}

const NOT_CONTINUATION_WORDS: ReadonlySet<string> = new Set(["and", "or", "if", "else", "in", "is", "not", "for"]);
const OPERATOR_START = "+-*/%<>=!&|^~@.([:{";

/**
 * Whether a Python `assert` statement whose tested expression ends at `at` ends there: the body is whitespace-collapsed,
 * so the next token must be the end of the body, a comma (the message), a semicolon, or the start of another statement
 * (a word that is not an operator word), never an operator or a bracket that would carry the expression on.
 */
function endsAssert(text: string, at: number): boolean {
  const i = skipSpaces(text, at);
  if (i >= text.length) return true;
  const ch = text[i] as string;
  if (ch === "," || ch === ";") return true;
  if (OPERATOR_START.includes(ch)) return false;
  if (isWord(text.charCodeAt(i))) {
    let end = i;
    while (end < text.length && isWord(text.charCodeAt(end))) end++;
    return !NOT_CONTINUATION_WORDS.has(text.slice(i, end));
  }
  return true;
}

/** `assert True` or `assert L == L`, ending the statement, with the `assert` at `p`. */
function pyAssert(text: string, p: number): boolean {
  const after = p + "assert".length;
  if (after >= text.length || !isSpace(text.charCodeAt(after))) return false;
  const start = skipSpaces(text, after);
  const firstEnd = literalEnd(text, start, "py");
  if (firstEnd === -1) return false;
  const equals = expectToken(text, firstEnd, "==");
  if (equals !== -1) {
    const secondStart = skipSpaces(text, equals);
    const secondEnd = literalEnd(text, secondStart, "py");
    if (
      secondEnd !== -1 &&
      text.slice(start, firstEnd) === text.slice(secondStart, secondEnd) &&
      endsAssert(text, secondEnd)
    ) {
      return true;
    }
  }
  return text.slice(start, firstEnd) === "True" && endsAssert(text, firstEnd);
}

/** `self.assertTrue(True)` or `self.assertEqual(L, L)` with `self.` at `p`. */
function pySelf(text: string, p: number): boolean {
  const nameAt = p + "self.".length;
  if (text.startsWith("assertTrue", nameAt)) {
    const open = expectToken(text, nameAt + "assertTrue".length, "(");
    if (open === -1) return false;
    const start = skipSpaces(text, open);
    return text.startsWith("True", start) && expectToken(text, start + 4, ")") !== -1;
  }
  if (text.startsWith("assertEqual", nameAt)) {
    const open = expectToken(text, nameAt + "assertEqual".length, "(");
    if (open === -1) return false;
    const end = sameLiteral(
      text,
      skipSpaces(text, open),
      (e) => {
        const comma = expectToken(text, e, ",");
        return comma === -1 ? -1 : skipSpaces(text, comma);
      },
      "py",
    );
    return end !== -1 && expectToken(text, end, ")") !== -1;
  }
  return false;
}

/** Every index of `needle` in `text`, in order; one `indexOf` pass, linear in the text. */
function* occurrences(text: string, needle: string): Generator<number> {
  let at = text.indexOf(needle);
  while (at !== -1) {
    yield at;
    at = text.indexOf(needle, at + 1);
  }
}

/**
 * How many assertions in a normalized test body compare a literal with itself, so they cannot fail. JavaScript:
 * `expect(L).toBe|toEqual|toStrictEqual(L)` (not negated), `assert.equal|strictEqual|deepEqual|deepStrictEqual(L, L)`,
 * `assert(true)` and `assert.ok(true)`. Python: `assert True`, `assert L == L` (the statement must end after the second
 * literal), `self.assertTrue(True)` and `self.assertEqual(L, L)`. Both literals must have the same text. A hand-written
 * scan: each candidate costs at most a bounded number of steps, so the whole is linear in the body.
 */
export function countTautologies(body: string, language: TautologyLanguage): number {
  let count = 0;
  if (language === "js") {
    for (const at of occurrences(body, "expect(")) {
      if (atBoundary(body, at) && jsExpect(body, at)) count++;
    }
    for (const at of occurrences(body, "assert")) {
      if (atBoundary(body, at) && jsAssert(body, at)) count++;
    }
    return count;
  }
  for (const at of occurrences(body, "assert")) {
    if (atBoundary(body, at) && pyAssert(body, at)) count++;
  }
  for (const at of occurrences(body, "self.")) {
    if (atBoundary(body, at) && pySelf(body, at)) count++;
  }
  return count;
}
