/** The equality matchers whose subject and argument are read. */
export const EQUALITY_MATCHERS = ["toBe", "toEqual", "toStrictEqual"] as const;
export type EqualityMatcher = (typeof EQUALITY_MATCHERS)[number];

/** The longest start and end of an `expect(…)` subject that is kept, in UTF-16 code units. */
const SUBJECT_HEAD_CHARS = 64;
const SUBJECT_TAIL_CHARS = 96;
/** The longest part of a first argument that is kept. */
const ARGUMENT_CHARS = 200;
/** The most white space skipped at either end of a subject before its slices are taken. */
const MAX_TRIM = 64;

/** One non-negated `.toBe(…)`, `.toEqual(…)` or `.toStrictEqual(…)` call read from a test body. */
export interface EqualityCall {
  matcher: EqualityMatcher;
  /**
   * The start and the end of the subject of the `expect(…)` the call directly follows (a space is allowed between),
   * trimmed; null when the call does not directly follow an `expect(…)` (`.resolves.toBe(…)`, a `.toBe(` outside any
   * `expect`).
   */
  subject: { head: string; tail: string } | null;
  /** The trimmed text of the first argument, cut to 200 code units (empty with no argument). */
  firstArgument: string;
}

interface Frame {
  open: string;
  /** The call this parenthesis opens, filled in as the scan reaches its first comma and its end. */
  call: EqualityCall | null;
  /** Where the first argument of the call began; -1 once it has been read. */
  argumentStart: number;
  /** For the parenthesis of `expect(` or `expect.soft(`: where the subject begins; -1 for any other frame. */
  subjectStart: number;
  /** For a subject frame: where the subject ends (its first top-level comma), or -1 while none was seen. */
  subjectEnd: number;
}

const CLOSERS: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };

const isIdentifierChar = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;

const isBlank = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13;

/** Whether the word `word` ends right before `at`, with no identifier character or `.` before it. */
function wordBefore(body: string, at: number, word: string): boolean {
  const start = at - word.length;
  if (start < 0 || !body.startsWith(word, start)) return false;
  if (start === 0) return true;
  const before = body.charCodeAt(start - 1);
  return !isIdentifierChar(before) && before !== 46;
}

/** Whether the `(` at `at` opens the subject of `expect(` or `expect.soft(`. */
function opensSubject(body: string, at: number): boolean {
  return wordBefore(body, at, "expect") || wordBefore(body, at, "expect.soft");
}

/** The equality matcher when the `(` at `at` follows `.<matcher>` or `.<matcher> ` and is not negated by `.not`; also the dot. */
function equalityBefore(body: string, at: number): { matcher: EqualityMatcher; dot: number } | null {
  let end = at;
  if (end > 0 && body.charCodeAt(end - 1) === 32) end--;
  for (const name of EQUALITY_MATCHERS) {
    const start = end - name.length;
    if (start < 1 || !body.startsWith(name, start) || body.charCodeAt(start - 1) !== 46) continue;
    if (start >= 5 && body.startsWith(".not", start - 5)) return null;
    return { matcher: name, dot: start - 1 };
  }
  return null;
}

/** The index after the string literal that opens at `at` (a quote character), or the end of the body when it never closes. */
function skipLiteral(body: string, at: number): number {
  const quote = body.charCodeAt(at);
  let i = at + 1;
  while (i < body.length) {
    const code = body.charCodeAt(i);
    if (code === 92) i += 2;
    else if (code === quote) return i + 1;
    else i++;
  }
  return body.length;
}

function argumentText(body: string, start: number, end: number): string {
  return body.slice(start, Math.min(end, start + ARGUMENT_CHARS)).trim();
}

/** The bounded head and tail of the subject between `start` and `end`, white space at either end skipped. */
function subjectOf(body: string, start: number, end: number): { head: string; tail: string } {
  let from = start;
  while (from < end && from - start < MAX_TRIM && isBlank(body.charCodeAt(from))) from++;
  let to = end;
  while (to > from && end - to < MAX_TRIM && isBlank(body.charCodeAt(to - 1))) to--;
  return {
    head: body.slice(from, Math.min(to, from + SUBJECT_HEAD_CHARS)).trim(),
    tail: body.slice(Math.max(from, to - SUBJECT_TAIL_CHARS), to).trim(),
  };
}

/**
 * The non-negated `.toBe(…)`, `.toEqual(…)` and `.toStrictEqual(…)` calls of a test body, in the order their
 * parentheses open, each with the bounded start and end of the subject of the `expect(…)` it directly follows and its
 * first top-level argument. One left-to-right pass with a bracket stack over `()[]{}` that skips `'…'`, `"…"` and
 * `` `…` `` literals (a backslash skips one character; a literal that never closes runs to the end of the body). The
 * reader keeps no more than the bounded slices above, so it is linear in the body.
 */
export function readEqualityCalls(body: string): EqualityCall[] {
  const calls: EqualityCall[] = [];
  const stack: Frame[] = [];
  let lastSubjectClose = -2;
  let lastSubject: { head: string; tail: string } | null = null;
  let i = 0;
  while (i < body.length) {
    const code = body.charCodeAt(i);
    if (code === 39 || code === 34 || code === 96) {
      i = skipLiteral(body, i);
      continue;
    }
    if (code === 40 || code === 91 || code === 123) {
      let call: EqualityCall | null = null;
      let subjectStart = -1;
      if (code === 40) {
        const found = equalityBefore(body, i);
        if (found !== null) {
          const adjacent =
            found.dot === lastSubjectClose + 1 ||
            (found.dot === lastSubjectClose + 2 && body.charCodeAt(lastSubjectClose + 1) === 32);
          call = { matcher: found.matcher, subject: adjacent ? lastSubject : null, firstArgument: "" };
          calls.push(call);
        } else if (opensSubject(body, i)) {
          subjectStart = i + 1;
        }
      }
      stack.push({
        open: body[i] as string,
        call,
        argumentStart: call === null ? -1 : i + 1,
        subjectStart,
        subjectEnd: -1,
      });
      i++;
      continue;
    }
    const closes = CLOSERS[body[i] as string];
    if (closes !== undefined) {
      const top = stack[stack.length - 1];
      if (top !== undefined && top.open === closes) {
        stack.pop();
        if (top.call !== null && top.argumentStart >= 0)
          top.call.firstArgument = argumentText(body, top.argumentStart, i);
        if (top.subjectStart >= 0) {
          lastSubjectClose = i;
          lastSubject = subjectOf(body, top.subjectStart, top.subjectEnd >= 0 ? top.subjectEnd : i);
        }
      }
      i++;
      continue;
    }
    if (code === 44) {
      const top = stack[stack.length - 1];
      if (top !== undefined && top.open === "(") {
        if (top.call !== null && top.argumentStart >= 0) {
          top.call.firstArgument = argumentText(body, top.argumentStart, i);
          top.argumentStart = -1;
        }
        if (top.subjectStart >= 0 && top.subjectEnd < 0) top.subjectEnd = i;
      }
    }
    i++;
  }
  for (let at = stack.length - 1; at >= 0; at--) {
    const frame = stack[at] as Frame;
    if (frame.call !== null && frame.argumentStart >= 0) {
      frame.call.firstArgument = argumentText(body, frame.argumentStart, body.length);
    }
  }
  return calls;
}
