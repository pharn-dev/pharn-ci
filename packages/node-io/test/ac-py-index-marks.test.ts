import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside the test body: these tests are written before it exists, so nothing the build
// adds may run while the file loads. The fixture and its golden are written by the build, so the test also checks
// that the fixture holds every form AC-4 lists and derives each block's modifiers from the fixture text with a small
// scanner written here: a golden fitted to the output cannot pass on its own. The real interpreter runs; a missing
// python3 fails the test.

const SLOW = 60_000;
const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/py-index/${name}`, import.meta.url), "utf8");

type Assertion = { chain: string; line: number; awaited: boolean; inTryCatch: boolean; afterEarlyReturn: boolean };
type Block = {
  kind: string;
  name: string;
  nameDynamic: boolean;
  path: string[];
  line: number;
  endLine: number;
  modifiers: string[];
  body: string;
  bodyHash: string;
  assertionCount: number;
  assertions: Assertion[];
  guards: unknown[];
};
type Mock = { callee: string; specifier: string | null; line: number };
type Index = { parsed: true; syntaxErrors: number; tests: Block[]; mocks: Mock[] };
type Result = Index | { parsed: false; reason: string };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };

async function indexOne(path: string, text: string): Promise<Result> {
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTests: (files: { path: string; text: string }[]) => Promise<Run>;
  };
  const run = await io.indexPythonTests([{ path, text }]);
  if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
  expect(run.files.map((f) => f.path)).toEqual([path]);
  return (run.files[0] as { result: Result }).result;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 lowercase hex digits (#87's fnv1a32Hex). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const MODIFIERS = ["skip", "only", "todo", "fails", "concurrent", "each", "skipIf", "runIf"];
const PY_CALLEES = [
  "patch",
  "mock.patch",
  "unittest.mock.patch",
  "mocker.patch",
  "patch.object",
  "mock.patch.object",
  "unittest.mock.patch.object",
  "mocker.patch.object",
  "monkeypatch.setattr",
];

/** The SPEC's contract for a parsed Python file, checked on every block, assertion and mock. */
function expectContract(result: Result): Index {
  if (!result.parsed) throw new Error(`expected an index, got the refusal ${JSON.stringify(result)}`);
  expect(Object.keys(result).sort()).toEqual(["mocks", "parsed", "syntaxErrors", "tests"]);
  expect(result.syntaxErrors).toBe(0);
  let previous = 1;
  result.tests.forEach((b, i) => {
    expect(Object.keys(b).sort()).toEqual([
      "assertionCount",
      "assertions",
      "body",
      "bodyHash",
      "endLine",
      "guards",
      "kind",
      "line",
      "modifiers",
      "name",
      "nameDynamic",
      "path",
    ]);
    expect(["describe", "test", "hook"]).toContain(b.kind);
    expect(b.nameDynamic).toBe(false);
    expect(b.line, "blocks in source order").toBeGreaterThanOrEqual(previous);
    previous = b.line;
    expect(b.endLine).toBeGreaterThanOrEqual(b.line);
    expect(b.path.at(-1)).toBe(b.name);
    expect(b.modifiers).toEqual(MODIFIERS.filter((m) => b.modifiers.includes(m)));
    expect(b.body.length).toBeLessThanOrEqual(4000);
    expect(b.bodyHash).toMatch(/^[0-9a-f]{8}$/);
    if (b.body.length < 4000) expect(b.bodyHash).toBe(fnv1a(b.body));
    expect(b.assertionCount).toBe(b.assertions.length);
    expect(b.guards).toEqual([]);
    if (b.path.length > 1) {
      const parent = result.tests
        .slice(0, i)
        .some(
          (p) =>
            p.kind === "describe" &&
            JSON.stringify(p.path) === JSON.stringify(b.path.slice(0, -1)) &&
            p.line < b.line &&
            p.endLine >= b.endLine,
        );
      expect(parent, `the enclosing class block of ${JSON.stringify(b.path)}`).toBe(true);
    }
    for (const a of b.assertions) {
      expect(Object.keys(a).sort()).toEqual(["afterEarlyReturn", "awaited", "chain", "inTryCatch", "line"]);
      expect(a.line).toBeGreaterThanOrEqual(b.line);
      expect(a.line).toBeLessThanOrEqual(b.endLine);
    }
  });
  for (const m of result.mocks) {
    expect(Object.keys(m).sort()).toEqual(["callee", "line", "specifier"]);
    expect(PY_CALLEES).toContain(m.callee);
  }
  return result;
}

// ---- A small Python scanner, enough for hand-written fixtures; not a Python parser. ----

/** One logical line: a statement or clause header, possibly spanning physical lines inside brackets or strings. */
interface Logical {
  /** 1-based physical lines of the first and the last code character. */
  line: number;
  endLine: number;
  /** The column of the first character. */
  indent: number;
  /** Source offsets: the first character, and one past the last code character. */
  start: number;
  end: number;
  /** The source slice with comments blanked. */
  text: string;
  /** The same with the contents of string literals blanked too (quotes kept), so offsets line up with `text`. */
  code: string;
}

function scan(source: string): { lines: Logical[]; lineOf: (offset: number) => number } {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const text = source.split("");
  const code = source.split("");
  const blank = (chars: string[], from: number, to: number) => {
    for (let k = from; k < to; k++) if (chars[k] !== "\n") chars[k] = " ";
  };
  const lines: Logical[] = [];
  let cur: { start: number; end: number } | null = null;
  let depth = 0;
  const close = () => {
    if (cur === null) return;
    const { start, end } = cur;
    const line = lineOf(start);
    lines.push({
      line,
      endLine: lineOf(end - 1),
      indent: start - (starts[line - 1] as number),
      start,
      end,
      text: text.slice(start, end).join(""),
      code: code.slice(start, end).join(""),
    });
    cur = null;
    depth = 0;
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    if (c === "\n") {
      if (depth === 0) close();
      i++;
      continue;
    }
    if (c === "#") {
      let j = source.indexOf("\n", i);
      if (j < 0) j = source.length;
      blank(text, i, j);
      blank(code, i, j);
      i = j;
      continue;
    }
    if (c === "\\" && source[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (cur === null) {
      if (c === " " || c === "\t" || c === "\f" || c === "\r") {
        i++;
        continue;
      }
      cur = { start: i, end: i + 1 };
    }
    if (c === '"' || c === "'") {
      const quote = source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < source.length && !source.startsWith(quote, j)) {
        if (source[j] === "\\") j++;
        else if (source[j] === "\n" && quote.length === 1) break;
        j++;
      }
      const closed = source.startsWith(quote, j);
      blank(code, i + quote.length, j);
      j = Math.min(source.length, j + (closed ? quote.length : 0));
      cur.end = j;
      i = j;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    if (c !== " " && c !== "\t" && c !== "\r") cur.end = i + 1;
    i++;
  }
  close();
  return { lines, lineOf };
}

/** The top-level arguments of the call whose `(` is at `open` in `l.code`, each as its text and code. */
function callArgs(l: Logical, open: number): { text: string; code: string }[] {
  const args: { text: string; code: string }[] = [];
  let depth = 0;
  let from = open + 1;
  const push = (to: number) => {
    if (l.code.slice(from, to).trim() !== "")
      args.push({ text: l.text.slice(from, to).trim(), code: l.code.slice(from, to).trim() });
  };
  for (let k = open; k < l.code.length; k++) {
    const c = l.code[k] as string;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        push(k);
        return args;
      }
    } else if (c === "," && depth === 1) {
      push(k);
      from = k + 1;
    }
  }
  return args;
}

interface Def {
  kind: "def" | "class";
  name: string;
  bases: string[];
  index: number;
  line: number;
  indent: number;
  endLine: number;
  decorators: Logical[];
  parent: Def | null;
}

/** Every def and class with its decorators, bases, enclosing def and last line; and the innermost def of each line. */
function scanDefs(lines: Logical[]): { defs: Def[]; owner: (Def | null)[] } {
  const defs: Def[] = [];
  const owner: (Def | null)[] = [];
  const stack: Def[] = [];
  lines.forEach((l, index) => {
    while (stack.length > 0 && (stack[stack.length - 1] as Def).indent >= l.indent) stack.pop();
    for (const d of stack) d.endLine = Math.max(d.endLine, l.endLine);
    owner.push(stack.at(-1) ?? null);
    const fn = /^(?:async\s+)?def\s+(\w+)/.exec(l.code);
    const cls = /^class\s+(\w+)/.exec(l.code);
    const head = fn ?? cls;
    if (head === null) return;
    const decorators: Logical[] = [];
    for (let k = index - 1; k >= 0; k--) {
      const p = lines[k] as Logical;
      if (p.indent !== l.indent || !p.code.startsWith("@")) break;
      decorators.unshift(p);
    }
    let bases: string[] = [];
    if (cls !== null && /^\s*\(/.test(l.code.slice(cls[0].length))) {
      bases = callArgs(l, l.code.indexOf("(", cls[0].length))
        .map((a) => a.code)
        .filter((b) => !/^\w+\s*=(?!=)/.test(b) && !b.startsWith("*"));
    }
    const d: Def = {
      kind: fn ? "def" : "class",
      name: head[1] as string,
      bases,
      index,
      line: l.line,
      indent: l.indent,
      endLine: l.endLine,
      decorators,
      parent: stack.at(-1) ?? null,
    };
    defs.push(d);
    stack.push(d);
  });
  return { defs, owner };
}

/** A decorator's dotted name: `@pytest.fixture(scope="module")` gives `pytest.fixture`. */
const decoratorName = (d: Logical) => (d.code.slice(1).split("(")[0] as string).trim();

const HOOK_METHODS = new Set([
  "setup_method",
  "teardown_method",
  "setup_class",
  "teardown_class",
  "setUp",
  "tearDown",
  "setUpClass",
  "tearDownClass",
  "asyncSetUp",
  "asyncTearDown",
]);

const isFixture = (d: Def) => d.decorators.some((x) => ["pytest.fixture", "fixture"].includes(decoratorName(x)));

function isTestClass(d: Def): boolean {
  if (d.kind !== "class") return false;
  if (d.parent !== null && !isTestClass(d.parent)) return false;
  return d.name.startsWith("Test") || d.bases.some((b) => (b.split(".").at(-1) as string).endsWith("TestCase"));
}

/** The block kind the SPEC gives a def or class (AC-1 to AC-3), or null for none. */
function blockKind(d: Def): "describe" | "test" | "hook" | null {
  if (d.kind === "class") return isTestClass(d) ? "describe" : null;
  if (d.parent === null) {
    if (isFixture(d)) return "hook";
    if (d.name.startsWith("test")) return "test";
    if (/^(?:setup_|teardown_)/.test(d.name) || d.name === "setUpModule" || d.name === "tearDownModule") return "hook";
    return null;
  }
  if (isTestClass(d.parent)) {
    if (isFixture(d) || HOOK_METHODS.has(d.name)) return "hook";
    if (d.name.startsWith("test")) return "test";
  }
  return null;
}

/** The innermost block def that holds logical line `index`, or null. */
function innermostBlock(owner: (Def | null)[], index: number): Def | null {
  for (let d = owner[index] ?? null; d !== null; d = d.parent) if (blockKind(d) !== null) return d;
  return null;
}

/** The first word of a logical line's code. */
const headWord = (l: Logical) => /^\w+/.exec(l.code)?.[0];

/** The decorator modifiers AC-4 lists, by exact dotted name. */
const DECORATOR_MODIFIERS = new Map([
  ["pytest.mark.skip", "skip"],
  ["mark.skip", "skip"],
  ["unittest.skip", "skip"],
  ["skip", "skip"],
  ["pytest.mark.skipif", "skipIf"],
  ["unittest.skipIf", "skipIf"],
  ["skipIf", "skipIf"],
  ["unittest.skipUnless", "runIf"],
  ["skipUnless", "runIf"],
  ["pytest.mark.xfail", "fails"],
  ["unittest.expectedFailure", "fails"],
  ["expectedFailure", "fails"],
  ["pytest.mark.parametrize", "each"],
]);

const isKeywordArg = (a: { code: string }) => /^\w+\s*=(?!=)/.test(a.code);
/** A str or bytes literal (an f-string is not a string constant). */
const isStringArg = (a: { text: string }) => /^(?:[rRuUbB]|[rR][bB]|[bB][rR])?["']/.test(a.text);

/** What an xfail decorator's arguments add: skipIf for a non-string first positional or a `condition=` keyword. */
function xfailConditional(x: Logical): boolean {
  const open = x.code.indexOf("(");
  if (open < 0) return false;
  const args = callArgs(x, open);
  const first = args[0];
  const positional = first !== undefined && !isKeywordArg(first) && !first.code.startsWith("*");
  return (positional && !isStringArg(first)) || args.some((a) => /^condition\s*=(?!=)/.test(a.code));
}

function decoratorModifiers(d: Def): string[] {
  const out: string[] = [];
  for (const x of d.decorators) {
    const modifier = DECORATOR_MODIFIERS.get(decoratorName(x));
    if (modifier === undefined) continue;
    out.push(modifier);
    if (decoratorName(x) === "pytest.mark.xfail" && xfailConditional(x)) out.push("skipIf");
  }
  return out;
}

type Context = "plain" | "if" | "ternary" | "while" | "match" | "except" | "boolop" | "nested" | "unknown";
const CONDITIONAL: Context[] = ["if", "ternary", "while", "match", "except", "boolop"];

/** The head word of the clause an `else` at logical line `k` belongs to (the nearest earlier line at its indent). */
function elsePair(lines: Logical[], k: number): string | undefined {
  const indent = (lines[k] as Logical).indent;
  for (let j = k - 1; j >= 0; j--) {
    const p = lines[j] as Logical;
    if (p.indent < indent) return undefined;
    if (p.indent === indent) return headWord(p);
  }
  return undefined;
}

/** The condition a clause header puts its body (and its own test) under, if any. */
function headerContext(lines: Logical[], k: number): Context | null {
  const word = headWord(lines[k] as Logical);
  if (word === "if" || word === "elif") return "if";
  if (word === "while") return "while";
  if (word === "match" || word === "case") return "match";
  if (word === "except") return "except";
  if (word === "else") {
    const pair = elsePair(lines, k);
    if (pair === "if" || pair === "elif") return "if";
    if (pair === "while") return "unknown";
  }
  return null;
}

/** The end (offset of its closing parenthesis) of the call whose `(` is at `open` in `code`. */
function callEnd(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    const c = code[k];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return code.length - 1;
}

/** Where an in-body skip or xfail call at `at` in logical line `index` of function block `block` sits. */
function contextOf(lines: Logical[], index: number, block: Def, at: number, open: number): Context {
  const l = lines[index] as Logical;
  if (/\blambda\b/.test(l.code.slice(0, at))) return "unknown";
  const own = headerContext(lines, index);
  if (own !== null) return own;
  const rest = l.code.slice(0, at) + l.code.slice(callEnd(l.code, open) + 1);
  if (/\bif\b/.test(rest) && /\belse\b/.test(rest)) return "ternary";
  if (/\b(?:and|or)\b/.test(rest)) return "boolop";
  let indent = l.indent;
  for (let k = index - 1; k > block.index; k--) {
    const p = lines[k] as Logical;
    if (p.indent >= indent) continue;
    indent = p.indent;
    const context = headerContext(lines, k);
    if (context !== null) return context;
  }
  return "plain";
}

interface BodyCall {
  call: string;
  line: number;
  block: Def;
  context: Context;
}

/** Every pytest.skip / pytest.xfail / self.skipTest call that sits in a block, with where it sits. */
function bodyCalls(text: string): { defs: Def[]; calls: BodyCall[] } {
  const { lines, lineOf } = scan(text);
  const { defs, owner } = scanDefs(lines);
  const calls: BodyCall[] = [];
  lines.forEach((l, index) => {
    for (const m of l.code.matchAll(/(?<![\w.])(pytest\s*\.\s*skip|pytest\s*\.\s*xfail|self\s*\.\s*skipTest)\s*\(/g)) {
      const block = innermostBlock(owner, index);
      if (block === null || block.kind !== "def") continue;
      const call = (m[1] as string).replace(/\s+/g, "");
      const line = lineOf(l.start + m.index);
      const open = m.index + m[0].length - 1;
      const context = owner[index] !== block ? "nested" : contextOf(lines, index, block, m.index, open);
      calls.push({ call, line, block, context });
    }
  });
  return { defs, calls };
}

/** What one in-body call adds to its block, or null when the scanner cannot tell. */
function callModifiers(call: BodyCall): string[] | null {
  if (call.context === "unknown") return null;
  if (call.context === "nested") return [];
  const conditional = CONDITIONAL.includes(call.context);
  if (call.call === "pytest.xfail") return conditional ? ["fails", "skipIf"] : ["fails"];
  return [conditional ? "skipIf" : "skip"];
}

describe("indexPythonTests on the marks fixture", () => {
  it(
    "AC-4: indexes test_marks.py to its golden, with decorator marks, in-body skips and xfails, and class decorators on the class only",
    async () => {
      const text = fixture("test_marks.py.txt");
      const golden = JSON.parse(fixture("test_marks.index.json")) as unknown;

      // The fixture holds every form AC-4 lists.
      const { defs, calls } = bodyCalls(text);
      const blocks = defs.filter((d) => blockKind(d) !== null);
      const decorators = blocks.flatMap((d) => d.decorators);
      for (const name of DECORATOR_MODIFIERS.keys()) {
        expect(
          decorators.some((x) => decoratorName(x) === name),
          `the fixture decorates a block with ${name}`,
        ).toBe(true);
      }
      const xfails = decorators.filter((x) => decoratorName(x) === "pytest.mark.xfail");
      const xfailWith = (test: (args: { text: string; code: string }[]) => boolean) =>
        xfails.some((x) => x.code.includes("(") && test(callArgs(x, x.code.indexOf("("))));
      const forms: [string, boolean][] = [
        [
          "an xfail with a non-string first positional argument",
          xfailWith((a) => a[0] !== undefined && !isKeywordArg(a[0]) && !isStringArg(a[0])),
        ],
        ["an xfail with a condition= keyword", xfailWith((a) => a.some((x) => /^condition\s*=/.test(x.code)))],
        ["an xfail that is not conditional", xfails.some((x) => !xfailConditional(x))],
        ["an unconditional pytest.skip(…)", calls.some((c) => c.call === "pytest.skip" && c.context === "plain")],
        ["an unconditional self.skipTest(…)", calls.some((c) => c.call === "self.skipTest" && c.context === "plain")],
        ...(["if", "ternary", "while", "match", "except", "boolop"] as Context[]).map((context): [string, boolean] => [
          `a skip inside ${context === "ternary" ? "a conditional expression" : context === "boolop" ? "a boolean operator" : `a ${context}`}`,
          calls.some((c) => c.call !== "pytest.xfail" && c.context === context),
        ]),
        ["an unconditional pytest.xfail(…)", calls.some((c) => c.call === "pytest.xfail" && c.context === "plain")],
        [
          "a conditional pytest.xfail(…)",
          calls.some((c) => c.call === "pytest.xfail" && CONDITIONAL.includes(c.context)),
        ],
        ["a skip inside a nested def", calls.some((c) => c.context === "nested")],
        ["a class decorator", blocks.some((d) => d.kind === "class" && decoratorModifiers(d).length > 0)],
      ];
      for (const [form, present] of forms) expect(present, `the fixture holds ${form}`).toBe(true);

      const result = await indexOne("tests/test_marks.py", text);
      expect(result).toStrictEqual(golden);
      const index = expectContract(result);

      // Each block's modifiers, derived from its own decorators and its own in-body calls, in TestModifier order.
      for (const d of blocks) {
        const block = index.tests.find((b) => b.line === d.line && b.name === d.name);
        expect(block, `the block ${d.name} at line ${d.line}`).toBeDefined();
        const own = calls.filter((c) => c.block === d).map(callModifiers);
        const known = [...decoratorModifiers(d), ...own.flatMap((m) => m ?? [])];
        if (own.includes(null)) {
          for (const m of known) expect(block?.modifiers, `${d.name} carries ${m}`).toContain(m);
        } else {
          expect(block?.modifiers, `the modifiers of ${d.name} at line ${d.line}`).toEqual(
            MODIFIERS.filter((m) => known.includes(m)),
          );
        }
      }
    },
    SLOW,
  );
});
