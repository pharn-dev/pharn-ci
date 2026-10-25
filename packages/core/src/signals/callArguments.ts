/** The matchers whose strength depends on their arguments. */
export const ARGUMENT_MATCHERS = ["toThrow", "toThrowError", "toHaveProperty", "toBeInstanceOf"] as const;
export type ArgumentMatcher = (typeof ARGUMENT_MATCHERS)[number];

/** One `.<matcher>(…)` call read from a test body. */
export interface MatcherCall {
  matcher: ArgumentMatcher;
  /** The number of top-level arguments that hold something. */
  args: number;
  /** The trimmed text of the first argument (empty with no argument). */
  firstArgument: string;
}

interface Frame {
  open: string;
  /** The call this parenthesis opens, filled in as the scan reaches its commas and its end. */
  call: MatcherCall | null;
  args: number;
  segmentHasContent: boolean;
  firstSet: boolean;
  /** Where the current top-level segment began. */
  segmentStart: number;
}

const CLOSERS: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };

/** The matcher name when the `(` at `at` follows `.<matcher>` or `.<matcher> ` and is not negated by `.not`, else null. */
function matcherBefore(body: string, at: number): ArgumentMatcher | null {
  let end = at;
  if (end > 0 && body.charCodeAt(end - 1) === 32) end--;
  for (const name of ARGUMENT_MATCHERS) {
    const start = end - name.length;
    if (start < 1 || !body.startsWith(name, start) || body.charCodeAt(start - 1) !== 46) continue;
    if (start >= 5 && body.startsWith(".not", start - 5)) return null;
    return name;
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

function closeSegment(frame: Frame, end: number, body: string): void {
  if (frame.segmentHasContent) {
    frame.args++;
    if (!frame.firstSet) {
      frame.firstSet = true;
      if (frame.call !== null) frame.call.firstArgument = body.slice(frame.segmentStart, end).trim();
    }
  }
  frame.segmentHasContent = false;
}

function finish(frame: Frame, end: number, body: string): void {
  closeSegment(frame, end, body);
  if (frame.call !== null) frame.call.args = frame.args;
}

/**
 * The `.toThrow(…)`, `.toThrowError(…)`, `.toHaveProperty(…)` and `.toBeInstanceOf(…)` calls of a test body, in body
 * order, with their top-level argument count and first argument. Calls under `.not` are left out. One left-to-right pass
 * with a bracket stack over `()[]{}` that skips `'…'`, `"…"` and `` `…` `` literals (a backslash skips one character; a
 * literal that never closes runs to the end of the body). A `(` with no matching `)` before the end of the body keeps
 * what the scan saw. Linear in the body.
 */
export function readMatcherCalls(body: string): MatcherCall[] {
  const calls: MatcherCall[] = [];
  const stack: Frame[] = [];
  let i = 0;
  while (i < body.length) {
    const code = body.charCodeAt(i);
    const top = stack[stack.length - 1];
    if (code === 39 || code === 34 || code === 96) {
      if (top !== undefined) top.segmentHasContent = true;
      i = skipLiteral(body, i);
      continue;
    }
    if (code === 40 || code === 91 || code === 123) {
      if (top !== undefined) top.segmentHasContent = true;
      const open = body[i] as string;
      let call: MatcherCall | null = null;
      if (code === 40) {
        const matcher = matcherBefore(body, i);
        if (matcher !== null) {
          call = { matcher, args: 0, firstArgument: "" };
          calls.push(call);
        }
      }
      stack.push({
        open,
        call,
        args: 0,
        segmentHasContent: false,
        firstSet: false,
        segmentStart: i + 1,
      });
      i++;
      continue;
    }
    const closes = CLOSERS[body[i] as string];
    if (closes !== undefined) {
      if (top !== undefined && top.open === closes) {
        stack.pop();
        finish(top, i, body);
        const parent = stack[stack.length - 1];
        if (parent !== undefined) parent.segmentHasContent = true;
      }
      i++;
      continue;
    }
    if (code === 44 && top !== undefined && top.open === "(") {
      closeSegment(top, i, body);
      top.segmentStart = i + 1;
    } else if (top !== undefined && code !== 32 && code !== 9) {
      top.segmentHasContent = true;
    }
    i++;
  }
  for (let at = stack.length - 1; at >= 0; at--) finish(stack[at] as Frame, body.length, body);
  return calls;
}
