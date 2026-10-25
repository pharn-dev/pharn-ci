import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// indexTestFile is loaded inside the test body: the AC tests are written before the test index exists, so nothing the
// build adds may run while the file loads. The fixture and its golden are written by the build, so the test also
// checks that the fixture holds every form AC-1 lists and pins the rules inline: a golden fitted to the output cannot
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
      expect(g.line).toBeGreaterThanOrEqual(b.line);
      expect(g.line).toBeLessThanOrEqual(b.endLine);
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

/** Every form AC-1 lists, as it appears in the fixture text. */
const FORMS: [string, RegExp][] = [
  ["it", /\bit\(/],
  ["test", /\btest\(/],
  [".skip", /\.skip\(/],
  [".only", /\.only\(/],
  [".todo", /\.todo\(/],
  [".fails", /\.fails\(/],
  [".concurrent", /\.concurrent\(/],
  [".skipIf(c)", /\.skipIf\(/],
  [".runIf(c)", /\.runIf\(/],
  [".each([…])", /\.each\(\s*\[/],
  ["a tagged-template .each table", /\.each`/],
  ["xit", /\bxit\(/],
  ["fit", /\bfit\(/],
  ["a test named by a template literal with a substitution", /\b(?:it|test)[\w.]*\(\s*`[^`]*\$\{/],
  ["beforeEach", /\bbeforeEach\(/],
  ["afterAll", /\bafterAll\(/],
  [".not", /expect\(.*\)\.not\./],
  [".resolves", /\.resolves\./],
  ["expect.soft", /expect\.soft\(/],
  ["an awaited expect", /\bawait\s+expect\(/],
  ["a try block", /\btry\s*\{/],
  ["a return", /\breturn\b/],
  ["expect.assertions(2)", /expect\.assertions\(\s*2\s*\)/],
  ["expect.hasAssertions()", /expect\.hasAssertions\(\s*\)/],
  ["vi.mock('./math.js')", /vi\.mock\(\s*(["'])\.\/math\.js\1/],
  ["vi.doMock with a non-literal specifier", /vi\.doMock\(\s*(?!import\s*\()[^"'`\s]/],
];

/** A block-opening line of the fixture and the modifier the block it opens must carry. */
const MODIFIER_LINES: [RegExp, string][] = [
  [/^\s*(?:it|test|describe)\b[\w.]*\.skip\(/, "skip"],
  [/^\s*(?:it|test|describe)\b[\w.]*\.only\(/, "only"],
  [/^\s*(?:it|test)\b[\w.]*\.todo\(/, "todo"],
  [/^\s*(?:it|test)\b[\w.]*\.fails\(/, "fails"],
  [/^\s*(?:it|test|describe)\b[\w.]*\.concurrent\(/, "concurrent"],
  [/^\s*(?:it|test|describe)\b[\w.]*\.skipIf\(/, "skipIf"],
  [/^\s*(?:it|test|describe)\b[\w.]*\.runIf\(/, "runIf"],
  [/^\s*(?:it|test|describe)\b[\w.]*\.each[(`]/, "each"],
  [/^\s*xit\(/, "skip"],
  [/^\s*fit\(/, "only"],
];

describe("indexTestFile on the vitest fixture", () => {
  it("AC-1: indexes math.test.ts to its hand-written golden math.index.json", async () => {
    const text = fixture("ts-index/vitest/math.test.ts.txt");
    const golden = JSON.parse(fixture("ts-index/vitest/math.index.json")) as unknown;
    for (const [form, re] of FORMS) expect(re.test(text), `the fixture holds ${form}`).toBe(true);
    expect(linesMatching(text, /^\s*describe\(/).length, "nested describe blocks").toBeGreaterThanOrEqual(2);

    const result = await indexTestFile("src/math.test.ts", text);
    expect(result).toStrictEqual(golden);
    const index = expectContract(result);
    const at = (line: number) => index.tests.filter((b) => b.line === line);

    // Nested describes.
    expect(index.tests.some((b) => b.kind === "describe" && b.path.length >= 2)).toBe(true);
    for (const line of linesMatching(text, /^\s*describe\(/)) {
      expect(at(line).some((b) => b.kind === "describe")).toBe(true);
    }
    // The modifier each block-opening line carries, from its root word and members.
    for (const [re, modifier] of MODIFIER_LINES) {
      const lines = linesMatching(text, re);
      expect(lines.length, `a block line carrying ${modifier}`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(
          at(line).some((b) => b.modifiers.includes(modifier)),
          `the block at line ${line} carries ${modifier}`,
        ).toBe(true);
      }
    }
    // Names: a template with a substitution and an .each name are dynamic.
    for (const line of linesMatching(text, /^\s*(?:it|test)\b[\w.]*\(\s*`[^`]*\$\{/)) {
      expect(at(line).some((b) => b.nameDynamic && b.name.includes("${"))).toBe(true);
    }
    for (const b of index.tests) if (b.modifiers.includes("each")) expect(b.nameDynamic).toBe(true);
    // Hooks are named by their word.
    for (const word of ["beforeEach", "afterAll"]) {
      const lines = linesMatching(text, new RegExp(`^\\s*${word}\\(`));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(at(line).some((b) => b.kind === "hook" && b.name === word)).toBe(true);
    }
    // Assertion chains and flags.
    const assertions = index.tests.flatMap((b) => b.assertions);
    expect(assertions.some((a) => /^expect\(\)\.not\./.test(a.chain))).toBe(true);
    expect(assertions.some((a) => /^expect\(\)\.resolves\./.test(a.chain))).toBe(true);
    expect(assertions.some((a) => /^expect\.soft\(\)\./.test(a.chain))).toBe(true);
    for (const line of linesMatching(text, /^\s*await\s+expect\(/)) {
      expect(assertions.some((a) => a.line === line && a.awaited)).toBe(true);
    }
    expect(assertions.some((a) => a.inTryCatch)).toBe(true);
    expect(assertions.some((a) => a.afterEarlyReturn)).toBe(true);
    expect(assertions.some((a) => /^expect\.(?:assertions|hasAssertions)\b/.test(a.chain))).toBe(false);
    // Guards.
    const guards = index.tests.flatMap((b) => b.guards);
    for (const line of linesMatching(text, /expect\.assertions\(\s*2\s*\)/)) {
      expect(guards).toContainEqual({ kind: "assertions", count: 2, line });
    }
    for (const line of linesMatching(text, /expect\.hasAssertions\(\s*\)/)) {
      expect(guards).toContainEqual({ kind: "hasAssertions", count: null, line });
    }
    // Mocks.
    for (const line of linesMatching(text, /vi\.mock\(\s*(["'])\.\/math\.js\1/)) {
      expect(index.mocks).toContainEqual({ callee: "vi.mock", specifier: "./math.js", line });
    }
    for (const line of linesMatching(text, /vi\.doMock\(\s*(?!import\s*\()[^"'`\s]/)) {
      expect(index.mocks).toContainEqual({ callee: "vi.doMock", specifier: null, line });
    }
  });
});
