/**
 * One-line readers for the test-integrity signals TI03 (skip) and TI04 (focused run). Each takes one kept line of a test
 * file (the diff reader cuts a line at 400 characters), looks at its start after leading white space, and scans it once
 * from left to right with no backtracking, so the time is linear in the line. A form that does not start the line (a
 * comment, a string, `if (x) this.skip()`, `solver.fit(x)`) is not read.
 */

import { resolvePythonName } from "./pythonAliases.js";

/** The language a test file's one-line forms are read in. */
export type TestLanguage = "jsts" | "python" | "go";

const JS_EXTENSIONS: readonly string[] = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];

/** The language of a test file by its path: JS/TS by extension, Python `.py`, Go `_test.go`; null for anything else. */
export function testLanguage(path: string): TestLanguage | null {
  if (path.endsWith("_test.go")) return "go";
  if (path.endsWith(".py")) return "python";
  for (const extension of JS_EXTENSIONS) if (path.endsWith(extension)) return "jsts";
  return null;
}

/** The longest name a line gets; a longer argument text is cut. */
const MAX_NAME = 120;

const isSpace = (c: string | undefined): boolean => c === " " || c === "\t";

function isWordCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 36 // $
  );
}

/** The index just after the identifier that starts at `start` (equal to `start` when there is none). */
function wordEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && isWordCode(text.charCodeAt(i))) i++;
  return i;
}

interface Arg {
  /** The argument text, trimmed. */
  text: string;
  /** The index of the character that ended it (the text length when the line ended first). */
  end: number;
  terminator: "," | ")" | "";
}

/**
 * Reads one call argument from `start` (just after `(` or `,`) to the comma or closing parenthesis that ends it at
 * bracket depth zero. Brackets and quotes (with backslash escapes) are tracked only to find that end; unbalanced text
 * simply ends the argument at the end of the line.
 */
function scanArg(text: string, start: number): Arg {
  let depth = 0;
  let quote = "";
  for (let i = start; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== "") {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth > 0) depth--;
      else if (c === ")") return { text: text.slice(start, i).trim(), end: i, terminator: ")" };
    } else if (c === "," && depth === 0) return { text: text.slice(start, i).trim(), end: i, terminator: "," };
  }
  return { text: text.slice(start).trim(), end: text.length, terminator: "" };
}

/** The content of an argument that is one whole string or template literal (quotes removed), else null. */
function stringContent(arg: string, prefixes: boolean): string | null {
  let i = 0;
  if (prefixes) while (i < 2 && i < arg.length && "rRbBuUfF".includes(arg.charAt(i))) i++;
  const quote = arg.charAt(i);
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;
  for (let j = i + 1; j < arg.length; j++) {
    const c = arg.charAt(j);
    if (c === "\\") j++;
    else if (c === quote) return arg.slice(j + 1).trim() === "" ? arg.slice(i + 1, j) : null;
  }
  return null;
}

/**
 * The name of a line from its first argument: the content of a string or template literal (so a change of quote style
 * keeps the name), else the argument text; at most 120 characters. Names are compared by content and never copied into a
 * report.
 */
export function argName(arg: string, python = false): string {
  return (stringContent(arg, python) ?? arg).slice(0, MAX_NAME);
}

export type JsToken = "skip" | "only" | "todo" | "fails" | "skipIf" | "runIf" | "none";

export interface JsTestLine {
  /** `call` is a test call (`it(`, `describe.only(`, `xit(`); `this-skip` is `this.skip(`. */
  kind: "call" | "this-skip";
  /** What the chain does: `skip` for `.skip` and every `x` head, `only` for `.only`, `fit` and `fdescribe`. */
  token: JsToken;
  /** The first argument of the call (of the second call for `skipIf` and `runIf`), trimmed. */
  arg: string;
  /** Whether `arg` is one string or template literal. */
  named: boolean;
  /** The name: `arg` by `argName`. */
  name: string;
  /** For `skipIf` and `runIf`, the first argument of the first call (the condition); else the empty string. */
  condition: string;
}

const JS_HEADS: ReadonlySet<string> = new Set(["it", "test", "describe", "context", "specify"]);
const JS_SKIP_HEADS: ReadonlySet<string> = new Set(["xit", "xtest", "xdescribe", "xcontext", "xspecify"]);
const JS_ONLY_HEADS: ReadonlySet<string> = new Set(["fit", "fdescribe"]);

function tokenOf(word: string): JsToken {
  switch (word) {
    case "skip":
    case "only":
    case "todo":
    case "fails":
    case "skipIf":
    case "runIf":
      return word;
    default:
      return "none";
  }
}

/**
 * Reads a JS/TS test call at the start of a line: a head word (`it`, `test`, `describe`, `context`, `specify`, the
 * `x`-prefixed ones, bare `fit` and `fdescribe`), any `.word` modifiers, then `(`; or `this.skip(`. Null when the line
 * is anything else.
 */
export function parseJsTestCall(text: string): JsTestLine | null {
  const line = text.trimStart();
  const headEnd = wordEnd(line, 0);
  if (headEnd === 0) return null;
  const head = line.slice(0, headEnd);
  let i = headEnd;

  if (head === "this") {
    if (!line.startsWith(".skip", i)) return null;
    i += ".skip".length;
    while (isSpace(line.charAt(i))) i++;
    if (line.charAt(i) !== "(") return null;
    const arg = scanArg(line, i + 1).text;
    return { kind: "this-skip", token: "skip", arg, named: false, name: argName(arg), condition: "" };
  }

  const skipHead = JS_SKIP_HEADS.has(head);
  const onlyHead = JS_ONLY_HEADS.has(head);
  if (!(JS_HEADS.has(head) || skipHead || onlyHead)) return null;
  let token: JsToken = skipHead ? "skip" : onlyHead ? "only" : "none";
  while (line.charAt(i) === ".") {
    const end = wordEnd(line, i + 1);
    if (end === i + 1) return null;
    if (token === "none") token = tokenOf(line.slice(i + 1, end));
    i = end;
  }
  while (isSpace(line.charAt(i))) i++;
  if (line.charAt(i) !== "(") return null;

  const first = scanArg(line, i + 1);
  if ((token === "skipIf" || token === "runIf") && first.terminator === ")") {
    // `it.skipIf(condition)('name', fn)`: the test name is the first argument of the second call.
    let j = first.end + 1;
    while (isSpace(line.charAt(j))) j++;
    const arg = line.charAt(j) === "(" ? scanArg(line, j + 1).text : "";
    return {
      kind: "call",
      token,
      arg,
      named: stringContent(arg, false) !== null,
      name: argName(arg),
      condition: first.text,
    };
  }
  return {
    kind: "call",
    token,
    arg: first.text,
    named: stringContent(first.text, false) !== null,
    name: argName(first.text),
    condition: "",
  };
}

export interface PythonSkipLine {
  kind: "decorator" | "call";
  /** The decorator (`pytest.mark.skip`) or the call (`pytest.skip`) as written. */
  token: string;
  /** The first argument by `argName`; the empty string when there is none. */
  name: string;
  /** For a decorator: whether its effect depends on a condition. Always false for a call. */
  conditional: boolean;
}

/** Python skip decorators and whether each depends on a condition (`xfail` is decided by its first argument). */
const PYTHON_DECORATORS: ReadonlyMap<string, "always" | "never" | "by-argument"> = new Map([
  ["pytest.mark.skip", "never"],
  ["pytest.mark.skipif", "always"],
  ["pytest.mark.xfail", "by-argument"],
  ["unittest.skip", "never"],
  ["unittest.skipIf", "always"],
  ["unittest.skipUnless", "always"],
  ["unittest.expectedFailure", "never"],
]);

/** The Python calls in a test body that stop or fail the test they sit in. */
const PYTHON_CALLS: ReadonlySet<string> = new Set(["pytest.skip", "pytest.xfail"]);

/**
 * The name `written` is in `table`: literally first (so `@pytest.mark.skip` matches whatever `pytest` is bound to), then,
 * when the file's top-level imports are known, by replacing its first segment with the name it is bound to. The table's
 * own name is returned, so a respelled line keeps the key of the line it replaces.
 */
function canonicalPython(
  written: string,
  table: ReadonlyMap<string, unknown> | ReadonlySet<string>,
  aliases: ReadonlyMap<string, string> | undefined,
): string | null {
  if (table.has(written)) return written;
  if (aliases === undefined) return null;
  const resolved = resolvePythonName(written, aliases);
  return resolved !== null && table.has(resolved) ? resolved : null;
}

function dottedEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && (isWordCode(text.charCodeAt(i)) || text.charAt(i) === ".")) i++;
  return i;
}

/** Whether an argument is a keyword argument (`reason="x"`): an identifier, optional spaces, one `=`. */
function isKeywordArg(arg: string): boolean {
  const end = wordEnd(arg, 0);
  if (end === 0) return false;
  let i = end;
  while (isSpace(arg.charAt(i))) i++;
  return arg.charAt(i) === "=" && arg.charAt(i + 1) !== "=";
}

/**
 * Reads a Python skip decorator, or `pytest.skip(` / `pytest.xfail(`, at the start of a line; null for anything else.
 * With `aliases` (the file's top-level imports, see `pythonImportAliases`) a name that is not in the tables as written
 * is also tried with its first segment replaced (`@pt.mark.skip` under `import pytest as pt`, `sk("r")` under `from
 * pytest import skip as sk`). The `token` returned is the table's name, whatever the spelling.
 */
export function parsePythonSkip(text: string, aliases?: ReadonlyMap<string, string>): PythonSkipLine | null {
  const line = text.trimStart();
  if (line.startsWith("@")) {
    const end = dottedEnd(line, 1);
    const token = canonicalPython(line.slice(1, end), PYTHON_DECORATORS, aliases);
    if (token === null) return null;
    const rule = PYTHON_DECORATORS.get(token);
    if (rule === undefined) return null;
    let i = end;
    while (isSpace(line.charAt(i))) i++;
    const arg = line.charAt(i) === "(" ? scanArg(line, i + 1).text : "";
    const conditional =
      rule === "always" ||
      (rule === "by-argument" && arg !== "" && stringContent(arg, true) === null && !isKeywordArg(arg));
    return { kind: "decorator", token, name: argName(arg, true), conditional };
  }
  const callEnd = dottedEnd(line, 0);
  const call = canonicalPython(line.slice(0, callEnd), PYTHON_CALLS, aliases);
  if (call === null) return null;
  let i = callEnd;
  while (isSpace(line.charAt(i))) i++;
  if (line.charAt(i) !== "(") return null;
  return { kind: "call", token: call, name: argName(scanArg(line, i + 1).text, true), conditional: false };
}

export interface GoSkipLine {
  /** `t.Skip`, `t.Skipf` or `t.SkipNow`. */
  token: string;
  name: string;
}

const GO_SKIPS: ReadonlySet<string> = new Set(["t.Skip", "t.Skipf", "t.SkipNow"]);

/** Reads `t.Skip(`, `t.Skipf(` or `t.SkipNow(` at the start of a line; null for anything else. */
export function parseGoSkip(text: string): GoSkipLine | null {
  const line = text.trimStart();
  const end = dottedEnd(line, 0);
  const token = line.slice(0, end);
  if (!GO_SKIPS.has(token)) return null;
  let i = end;
  while (isSpace(line.charAt(i))) i++;
  if (line.charAt(i) !== "(") return null;
  return { token, name: argName(scanArg(line, i + 1).text) };
}

/** Whether a Python line opens a test: `def test_…`, `async def test_…` or `class Test…`. */
export function opensPythonTest(text: string): boolean {
  const line = text.trimStart();
  return line.startsWith("def test_") || line.startsWith("async def test_") || line.startsWith("class Test");
}
