import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// indexTestFile is loaded inside the test body: the AC tests are written before the test index exists, so nothing the
// build adds may run while the file loads. The fixture and its golden are written by the build, so the test also
// checks that the fixture holds every form AC-2 lists and pins the rules inline: a golden fitted to the output cannot
// pass on its own.

type Assertion = { chain: string; line: number; awaited: boolean; inTryCatch: boolean; afterEarlyReturn: boolean };
type Guard = { kind: string; count: number | null; line: number };
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
  guards: Guard[];
};
type Mock = { callee: string; specifier: string | null; line: number };
type Index = { parsed: true; syntaxErrors: number; tests: Block[]; mocks: Mock[] };
type Result = Index | { parsed: false; reason: string };

const MODIFIERS = ["skip", "only", "todo", "fails", "concurrent", "each", "skipIf", "runIf"];
const HOOK_WORDS = ["beforeEach", "afterEach", "beforeAll", "afterAll", "before", "after"];
const MOCK_CALLEES = ["vi.mock", "vi.doMock", "jest.mock", "jest.doMock"];

async function indexTestFile(path: string, text: string): Promise<Result> {
  const core = (await import("@pharn-ci/core")) as unknown as { indexTestFile: (p: unknown, t: unknown) => unknown };
  return core.indexTestFile(path, text) as Result;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 lowercase hex digits (the SPEC's bodyHash). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A line break as the parser counts lines: CRLF, LF, CR, U+2028 or U+2029. */
const LINE_BREAK = new RegExp(["\r\n", "\n", "\r", String.fromCharCode(0x2028), String.fromCharCode(0x2029)].join("|"));

/** The 1-based numbers of the lines of `text` that match `re`. */
function linesMatching(text: string, re: RegExp): number[] {
  return text.split(LINE_BREAK).flatMap((line, i) => (re.test(line) ? [i + 1] : []));
}

/** The SPEC's contract, checked on every block, assertion, guard and mock of an index. */
function expectContract(result: Result): Index {
  if (!result.parsed) throw new Error(`expected an index, got the refusal ${JSON.stringify(result)}`);
  expect(Object.keys(result).sort()).toEqual(["mocks", "parsed", "syntaxErrors", "tests"]);
  let previous = 0;
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
    expect(b.line).toBeGreaterThanOrEqual(Math.max(previous, 1));
    previous = b.line;
    expect(b.endLine).toBeGreaterThanOrEqual(b.line);
    expect(b.path.at(-1)).toBe(b.name);
    expect(b.name.length).toBeLessThanOrEqual(500);
    if (b.kind === "hook") expect(HOOK_WORDS).toContain(b.name);
    expect(b.modifiers).toEqual(MODIFIERS.filter((m) => b.modifiers.includes(m)));
    expect(new Set(b.modifiers).size).toBe(b.modifiers.length);
    expect(b.body.length).toBeLessThanOrEqual(4000);
    expect(b.bodyHash).toMatch(/^[0-9a-f]{8}$/);
    if (b.body.length < 4000) expect(b.bodyHash).toBe(fnv1a(b.body));
    expect(b.assertionCount).toBe(b.assertions.length);
    if (b.path.length > 1) {
      const parent = result.tests
        .slice(0, i)
        .some(
          (p) =>
            JSON.stringify(p.path) === JSON.stringify(b.path.slice(0, -1)) &&
            p.line <= b.line &&
            p.endLine >= b.endLine,
        );
      expect(parent, `the enclosing block of ${JSON.stringify(b.path)}`).toBe(true);
    }
    let previousAssertion = b.line;
    for (const a of b.assertions) {
      expect(Object.keys(a).sort()).toEqual(["afterEarlyReturn", "awaited", "chain", "inTryCatch", "line"]);
      expect(typeof a.awaited === "boolean" && typeof a.inTryCatch === "boolean").toBe(true);
      expect(typeof a.afterEarlyReturn).toBe("boolean");
      expect(a.line).toBeGreaterThanOrEqual(previousAssertion);
      expect(a.line).toBeLessThanOrEqual(b.endLine);
      previousAssertion = a.line;
    }
    for (const g of b.guards) {
      expect(Object.keys(g).sort()).toEqual(["count", "kind", "line"]);
      expect(["assertions", "hasAssertions"]).toContain(g.kind);
      if (g.kind === "hasAssertions") expect(g.count).toBeNull();
    }
  });
  let previousMock = 0;
  for (const m of result.mocks) {
    expect(Object.keys(m).sort()).toEqual(["callee", "line", "specifier"]);
    expect(MOCK_CALLEES).toContain(m.callee);
    expect(m.specifier === null || typeof m.specifier === "string").toBe(true);
    expect(m.line).toBeGreaterThanOrEqual(previousMock);
    previousMock = m.line;
  }
  return result;
}

/** A function-reference callback: `test("name", handler)`, with no function literal. */
const REFERENCE_CALLBACK = /^\s*(?:it|test)\(\s*(["'])[^"']*\1\s*,\s*[A-Za-z_$][\w$]*\s*\)/;

/** Every form AC-2 lists, as it appears in the fixture text. */
const FORMS: [string, RegExp][] = [
  ["CommonJS require", /\brequire\(/],
  ["jest.mock('../src/db')", /jest\.mock\(\s*(["'])\.\.\/src\/db\1/],
  ["jest.doMock", /jest\.doMock\(/],
  ["xtest", /^\s*xtest\(/m],
  ["xdescribe", /^\s*xdescribe\(/m],
  ["fdescribe", /^\s*fdescribe\(/m],
  ["test.each with a tagged-template table", /^\s*test\.each`/m],
  ["describe.each([…])", /^\s*describe\.each\(\s*\[/m],
  ["beforeAll", /^\s*beforeAll\(/m],
  ["afterEach", /^\s*afterEach\(/m],
  [".rejects.toThrow(…)", /\.rejects\.toThrow\(/],
  ["toMatchSnapshot()", /\.toMatchSnapshot\(\s*\)/],
  ["a test whose callback is a function reference", new RegExp(REFERENCE_CALLBACK.source, "m")],
];

/** A block-opening line of the fixture, the kind of block it opens, and the modifier it must carry. */
const BLOCK_LINES: [RegExp, string, string | null][] = [
  [/^\s*xtest\(/, "test", "skip"],
  [/^\s*xdescribe\(/, "describe", "skip"],
  [/^\s*fdescribe\(/, "describe", "only"],
  [/^\s*test\.each`/, "test", "each"],
  [/^\s*describe\.each\(\s*\[/, "describe", "each"],
  [/^\s*describe\(/, "describe", null],
];

describe("indexTestFile on the jest fixture", () => {
  it("AC-2: indexes the CommonJS user.test.js to its golden user.index.json", async () => {
    const text = fixture("ts-index/jest/user.test.js.txt");
    const golden = JSON.parse(fixture("ts-index/jest/user.index.json")) as unknown;
    for (const [form, re] of FORMS) expect(re.test(text), `the fixture holds ${form}`).toBe(true);
    expect(/^\s*import\s/m.test(text), "a CommonJS file has no import statement").toBe(false);

    const result = await indexTestFile("test/user.test.js", text);
    expect(result).toStrictEqual(golden);
    const index = expectContract(result);
    const at = (line: number) => index.tests.filter((b) => b.line === line);

    for (const [re, kind, modifier] of BLOCK_LINES) {
      for (const line of linesMatching(text, re)) {
        expect(
          at(line).some((b) => b.kind === kind && (modifier === null || b.modifiers.includes(modifier))),
          `the ${kind} at line ${line} carries ${modifier}`,
        ).toBe(true);
      }
    }
    for (const b of index.tests) if (b.modifiers.includes("each")) expect(b.nameDynamic).toBe(true);
    for (const word of ["beforeAll", "afterEach"]) {
      for (const line of linesMatching(text, new RegExp(`^\\s*${word}\\(`))) {
        expect(at(line).some((b) => b.kind === "hook" && b.name === word)).toBe(true);
      }
    }
    // A function-reference callback is a test with an empty body.
    for (const line of linesMatching(text, REFERENCE_CALLBACK)) {
      expect(at(line)).toContainEqual(
        expect.objectContaining({ kind: "test", body: "", bodyHash: "811c9dc5", assertionCount: 0 }),
      );
    }
    const chains = index.tests.flatMap((b) => b.assertions.map((a) => a.chain));
    expect(chains.some((c) => /^expect\(\)\.rejects\.toThrow\(\)$/.test(c))).toBe(true);
    expect(chains.some((c) => /^expect\(\)\.toMatchSnapshot\(\)$/.test(c))).toBe(true);
    for (const line of linesMatching(text, /jest\.mock\(\s*(["'])\.\.\/src\/db\1/)) {
      expect(index.mocks).toContainEqual({ callee: "jest.mock", specifier: "../src/db", line });
    }
    for (const line of linesMatching(text, /jest\.doMock\(/)) {
      expect(index.mocks.some((m) => m.callee === "jest.doMock" && m.line === line)).toBe(true);
    }
  });
});
