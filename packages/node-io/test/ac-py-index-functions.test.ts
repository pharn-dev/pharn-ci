import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside the test body: these tests are written before it exists, so nothing the build
// adds may run while the file loads. The fixture and its golden are written by the build, so the test also checks
// that the fixture holds every form AC-1 lists and derives the expected blocks from the fixture text with a small
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

function classPath(d: Def): string[] {
  const names = [d.name];
  for (let p = d.parent; p !== null; p = p.parent) names.unshift(p.name);
  return names;
}

/** The blocks the SPEC's rules give the fixture text, in source order. */
function expectedBlocks(text: string) {
  const { defs } = scanDefs(scan(text).lines);
  return defs.flatMap((d) => {
    const kind = blockKind(d);
    return kind === null ? [] : [{ kind, name: d.name, path: classPath(d), line: d.line, endLine: d.endLine }];
  });
}

describe("indexPythonTests on the pytest functions fixture", () => {
  it(
    "AC-1: indexes test_functions.py to its golden, with tests, fixture and module hooks, and no nested or helper functions",
    async () => {
      const text = fixture("test_functions.py.txt");
      const golden = JSON.parse(fixture("test_functions.index.json")) as unknown;

      // The fixture holds every form AC-1 lists.
      const { lines } = scan(text);
      const { defs } = scanDefs(lines);
      const top = defs.filter((d) => d.kind === "def" && d.parent === null);
      const decorated = (d: Def, name: string, called: boolean) =>
        d.decorators.some((x) => decoratorName(x) === name && x.code.includes("(") === called);
      const forms: [string, boolean][] = [
        ["a def test_…", top.some((d) => /^test_/.test(d.name) && !isFixture(d))],
        [
          "an async def test…",
          top.some((d) => /^async\s/.test((lines[d.index] as Logical).code) && d.name.startsWith("test")),
        ],
        ["a test named like testAdd", top.some((d) => /^test(?!_)/.test(d.name) && !isFixture(d))],
        ["a bare @pytest.fixture", top.some((d) => decorated(d, "pytest.fixture", false))],
        ["a called @pytest.fixture(…)", top.some((d) => decorated(d, "pytest.fixture", true))],
        ["a bare @fixture", top.some((d) => decorated(d, "fixture", false))],
        ["a called @fixture(…)", top.some((d) => decorated(d, "fixture", true))],
        ["a fixture named test_…", top.some((d) => isFixture(d) && d.name.startsWith("test"))],
        ["a setup_* function", top.some((d) => d.name.startsWith("setup_"))],
        ["a teardown_* function", top.some((d) => d.name.startsWith("teardown_"))],
        ["setUpModule", top.some((d) => d.name === "setUpModule")],
        ["tearDownModule", top.some((d) => d.name === "tearDownModule")],
        ["a function nested in a function", defs.some((d) => d.kind === "def" && d.parent?.kind === "def")],
        ["another module-level function", top.some((d) => blockKind(d) === null)],
        [
          "a test whose decorator sits above its def line",
          top.some((d) => blockKind(d) === "test" && d.decorators.length > 0),
        ],
      ];
      for (const [form, present] of forms) expect(present, `the fixture holds ${form}`).toBe(true);

      const result = await indexOne("tests/test_functions.py", text);
      expect(result).toStrictEqual(golden);
      const index = expectContract(result);

      // The rules, derived from the text: kinds, names, def lines (not decorator lines), last lines, source order.
      expect(
        index.tests.map(({ kind, name, path, line, endLine }) => ({ kind, name, path, line, endLine })),
      ).toStrictEqual(expectedBlocks(text));
      for (const d of defs.filter((x) => x.kind === "def" && x.parent?.kind === "def")) {
        expect(
          index.tests.some((b) => b.line === d.line),
          `the nested function ${d.name} is no block`,
        ).toBe(false);
      }
    },
    SLOW,
  );
});
