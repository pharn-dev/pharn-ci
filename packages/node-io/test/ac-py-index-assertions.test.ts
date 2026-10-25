import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside the test body: these tests are written before it exists, so nothing the build
// adds may run while the file loads. The fixture and its golden are written by the build, so the test also checks
// that the fixture holds every form AC-6 lists and derives every block's assertions (chain, line and flags) from the
// fixture text with a small scanner written here: a golden fitted to the output cannot pass on its own. The real
// interpreter runs; a missing python3 fails the test.

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

/** The offset of the bracket that closes the one at `open` in `code`. */
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

/** The tokens of an expression's code outside any bracket: words, operators and opening brackets. */
function topTokens(code: string): { value: string; at: number; word: boolean }[] {
  const tokens: { value: string; at: number; word: boolean }[] = [];
  let k = 0;
  while (k < code.length) {
    const c = code[k] as string;
    if (/\s/.test(c)) {
      k++;
    } else if (c === "(" || c === "[" || c === "{") {
      tokens.push({ value: c, at: k, word: false });
      k = callEnd(code, k) + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const word = (/^[A-Za-z_]\w*/.exec(code.slice(k)) as RegExpExecArray)[0];
      tokens.push({ value: word, at: k, word: tokens.at(-1)?.value !== "." });
      k += word.length;
    } else {
      const two = code.slice(k, k + 2);
      const value = ["==", "!=", "<=", ">=", "<<", ">>", "->", "**", "//", ":="].includes(two) ? two : c;
      tokens.push({ value, at: k, word: false });
      k += value.length;
    }
  }
  return tokens;
}

/** The offset of an expression's first top-level comma, or its length. */
function topComma(code: string): number {
  const comma = topTokens(code).find((t) => t.value === ",");
  return comma === undefined ? code.length : comma.at;
}

const isCallOf = (operand: string, name: RegExp) =>
  name.test(operand) && callEnd(operand, operand.indexOf("(")) === operand.length - 1;

/** The chain AC-6 gives an `assert` statement, from the code of its expression. */
function assertChain(expression: string): string {
  let e = expression.slice(0, topComma(expression)).trim();
  while (e.startsWith("(") && callEnd(e, 0) === e.length - 1 && topComma(e.slice(1, -1)) === e.length - 2) {
    e = e.slice(1, -1).trim();
  }
  const tokens = topTokens(e);
  if (tokens.some((t) => t.word && ["lambda", "if", "or", "and", "for"].includes(t.value))) return "assert truthy";
  if (tokens[0]?.word && tokens[0].value === "not") return "assert not";
  const ops: { op: string; at: number; end: number }[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k] as { value: string; at: number; word: boolean };
    const next = tokens[k + 1];
    if (!t.word && ["==", "!=", "<", "<=", ">", ">="].includes(t.value)) {
      ops.push({ op: t.value, at: t.at, end: t.at + t.value.length });
    } else if (t.word && t.value === "is" && next?.word && next.value === "not") {
      ops.push({ op: "is not", at: t.at, end: next.at + 3 });
      k++;
    } else if (t.word && t.value === "is") {
      ops.push({ op: "is", at: t.at, end: t.at + 2 });
    } else if (t.word && t.value === "not" && next?.word && next.value === "in") {
      ops.push({ op: "not in", at: t.at, end: next.at + 2 });
      k++;
    } else if (t.word && t.value === "in") {
      ops.push({ op: "in", at: t.at, end: t.at + 2 });
    }
  }
  if (ops.length > 0) {
    const operands: string[] = [];
    let from = 0;
    for (const o of ops) {
      operands.push(e.slice(from, o.at).trim());
      from = o.end;
    }
    operands.push(e.slice(from).trim());
    if (operands.some((o) => isCallOf(o, /^(?:pytest\s*\.\s*)?approx\s*\(/))) return "assert approx";
    const only = ops[0] as { op: string };
    if (ops.length === 1 && (only.op === "is" || only.op === "is not") && operands.includes("None")) {
      return only.op === "is" ? "assert is None" : "assert is not None";
    }
    return `assert ${ops.map((o) => o.op).join(" ")}`;
  }
  if (isCallOf(e, /^isinstance\s*\(/)) return "assert isinstance";
  return "assert truthy";
}

interface Expected {
  chain: string;
  line: number;
  offset: number;
  awaited: boolean;
  inTryCatch: boolean;
  afterEarlyReturn: boolean;
  /** The innermost block, or null for an assertion outside every block. */
  block: Def | null;
  /** The innermost def is not the block itself. */
  nested: boolean;
  /** The expression text, for the form checks. */
  expression: string;
}

/** Whether the `try` at logical line `k` has at least one `except` handler. */
function hasHandler(lines: Logical[], k: number): boolean {
  const indent = (lines[k] as Logical).indent;
  for (let j = k + 1; j < lines.length; j++) {
    const l = lines[j] as Logical;
    if (l.indent > indent) continue;
    return l.indent === indent && headWord(l) === "except";
  }
  return false;
}

/** Every assertion of the fixture with the chain and flags AC-6 gives it. */
function expectedAssertions(text: string): Expected[] {
  const { lines, lineOf } = scan(text);
  const { owner } = scanDefs(lines);
  const out: Expected[] = [];
  const innermostFunction = (index: number) => {
    let d = owner[index] ?? null;
    while (d !== null && d.kind !== "def") d = d.parent;
    return d;
  };
  const returnEnds = lines.flatMap((l, index) =>
    /(?<![\w.])return\b/.test(l.code) ? [{ fn: innermostFunction(index), end: l.end }] : [],
  );
  lines.forEach((l, index) => {
    const found: { chain: string; at: number; awaited: boolean; expression: string }[] = [];
    for (const m of l.code.matchAll(/(?<![\w.])assert\b/g)) {
      const expression = l.code.slice(m.index + m[0].length);
      found.push({ chain: assertChain(expression), at: m.index, awaited: false, expression: l.text.slice(m.index) });
    }
    for (const m of l.code.matchAll(
      /(?<![\w.])(pytest\s*\.\s*(?:raises|warns|fail)|self\s*\.\s*(?:assert\w*|fail))\s*\(/g,
    )) {
      found.push({
        chain: `${(m[1] as string).replace(/\s+/g, "")}()`,
        at: m.index,
        awaited: /(?<![\w.])await\s*$/.test(l.code.slice(0, m.index)),
        expression: l.text.slice(m.index),
      });
    }
    found.sort((a, b) => a.at - b.at);
    const block = innermostBlock(owner, index);
    const fn = innermostFunction(index);
    let inTryCatch = false;
    if (block !== null) {
      let indent = l.indent;
      for (let k = index - 1; k > block.index; k--) {
        const p = lines[k] as Logical;
        if (p.indent >= indent) continue;
        indent = p.indent;
        if (headWord(p) === "try" && hasHandler(lines, k)) inTryCatch = true;
      }
    }
    for (const f of found) {
      const offset = l.start + f.at;
      out.push({
        chain: f.chain,
        line: lineOf(offset),
        offset,
        awaited: f.awaited,
        inTryCatch,
        afterEarlyReturn: returnEnds.some((r) => r.fn === fn && r.end <= offset),
        block,
        nested: block !== null && fn !== block,
        expression: f.expression,
      });
    }
  });
  return out;
}

const COMPARISON_CHAINS = [
  "assert ==",
  "assert !=",
  "assert <",
  "assert <=",
  "assert >",
  "assert >=",
  "assert is",
  "assert is not",
  "assert in",
  "assert not in",
];

describe("indexPythonTests on the assertions fixture", () => {
  it(
    "AC-6: indexes test_assertions.py to its golden, with assert chains, pytest helper chains and the awaited, try and early-return flags, in the innermost block",
    async () => {
      const text = fixture("test_assertions.py.txt");
      const golden = JSON.parse(fixture("test_assertions.index.json")) as unknown;

      // The fixture holds every form AC-6 lists.
      const all = expectedAssertions(text);
      const inBlocks = all.filter((a) => a.block !== null);
      const chains = new Set(inBlocks.map((a) => a.chain));
      for (const chain of [
        ...COMPARISON_CHAINS,
        "assert is None",
        "assert is not None",
        "assert approx",
        "assert < <=",
        "assert isinstance",
        "assert not",
        "assert truthy",
        "pytest.raises()",
        "pytest.warns()",
        "pytest.fail()",
      ]) {
        expect(chains.has(chain), `the fixture holds an assertion with chain ${chain}`).toBe(true);
      }
      const forms: [string, boolean][] = [
        [
          "a pytest.approx(…) side",
          inBlocks.some((a) => a.chain === "assert approx" && /pytest\s*\.\s*approx\s*\(/.test(a.expression)),
        ],
        [
          "an approx(…) side",
          inBlocks.some((a) => a.chain === "assert approx" && /(?<![\w.])approx\s*\(/.test(a.expression)),
        ],
        [
          "pytest.raises as a context manager",
          text.split("\n").some((l) => /^\s*(?:async\s+)?with\s+pytest\.raises\(/.test(l)),
        ],
        [
          "pytest.raises as a call",
          inBlocks.some((a) => a.chain === "pytest.raises()" && !/^\s*with\b/.test(lineText(text, a.line))),
        ],
        ["an awaited assertion", inBlocks.some((a) => a.awaited)],
        ["an assertion in a try body with a handler", inBlocks.some((a) => a.inTryCatch && !a.nested)],
        ["an assertion after an early return", inBlocks.some((a) => a.afterEarlyReturn)],
        ["a nested helper function inheriting the try", inBlocks.some((a) => a.nested && a.inTryCatch)],
        ["an assertion outside every block", all.some((a) => a.block === null)],
      ];
      for (const [form, present] of forms) expect(present, `the fixture holds ${form}`).toBe(true);

      const result = await indexOne("tests/test_assertions.py", text);
      expect(result).toStrictEqual(golden);
      const index = expectContract(result);

      // The rules, derived from the text: every block's assertions, in source order, each in its innermost block.
      const { defs } = scanDefs(scan(text).lines);
      const blocks = defs.filter((d) => blockKind(d) !== null);
      expect(index.tests.map((b) => [b.name, b.line])).toEqual(blocks.map((d) => [d.name, d.line]));
      blocks.forEach((d, i) => {
        const expected = inBlocks
          .filter((a) => a.block?.line === d.line && a.block.name === d.name)
          .map(({ chain, line, awaited, inTryCatch, afterEarlyReturn }) => ({
            chain,
            line,
            awaited,
            inTryCatch,
            afterEarlyReturn,
          }));
        expect(index.tests[i]?.assertions, `the assertions of ${d.name} at line ${d.line}`).toStrictEqual(expected);
      });
      for (const a of all.filter((x) => x.block === null)) {
        expect(
          index.tests.some((b) => b.assertions.some((x) => x.line === a.line)),
          `the assertion outside every block at line ${a.line} is not recorded`,
        ).toBe(false);
      }
    },
    SLOW,
  );
});

function lineText(text: string, line: number): string {
  return text.split("\n")[line - 1] ?? "";
}
