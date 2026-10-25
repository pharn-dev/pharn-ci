import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// indexTestFile is loaded inside the test body: the AC tests are written before the test index exists, so nothing the
// build adds may run while the file loads. The fixture and its golden are written by the build, so the test also
// checks that the fixture holds every form AC-3 lists and pins the rules inline: a golden fitted to the output cannot
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

/** The SPEC's contract, checked on every block, assertion and guard of an index. */
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
    if (b.kind === "hook") expect(HOOK_WORDS).toContain(b.name);
    expect(b.modifiers).toEqual(MODIFIERS.filter((m) => b.modifiers.includes(m)));
    expect(new Set(b.modifiers).size).toBe(b.modifiers.length);
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
    for (const a of b.assertions) {
      expect(Object.keys(a).sort()).toEqual(["afterEarlyReturn", "awaited", "chain", "inTryCatch", "line"]);
      expect(a.line).toBeGreaterThanOrEqual(b.line);
      expect(a.line).toBeLessThanOrEqual(b.endLine);
    }
  });
  return result;
}

/** Every form AC-3 lists, as it appears in the fixture text. */
const FORMS: [string, RegExp][] = [
  ["an import from node:test", /\bfrom\s+(["'])node:test\1/],
  ["assert imported from node:assert", /\bimport\s+assert\b[^;]*\bfrom\s+(["'])node:assert\1/],
  ["t.test subtests", /\bt\.test\(/],
  ["it.todo('later')", /\bit\.todo\(\s*(["'])later\1\s*\)/],
  ["assert(ok)", /\bassert\(\s*ok\s*\)/],
  ["assert.strictEqual(…)", /\bassert\.strictEqual\(/],
  ["assert.strict.equal(…)", /\bassert\.strict\.equal\(/],
  ["t.assert.ok(…)", /\bt\.assert\.ok\(/],
];

describe("indexTestFile on the node:test fixture", () => {
  it("AC-3: indexes api.test.mjs to its golden api.index.json, with subtest paths through their enclosing tests", async () => {
    const text = fixture("ts-index/node-test/api.test.mjs.txt");
    const golden = JSON.parse(fixture("ts-index/node-test/api.index.json")) as unknown;
    for (const [form, re] of FORMS) expect(re.test(text), `the fixture holds ${form}`).toBe(true);
    const imported = /\bimport\s*\{([^}]*)\}\s*from\s+(["'])node:test\2/.exec(text)?.[1] ?? "";
    for (const word of ["describe", "it", "test", "suite", "before", "after"]) {
      expect(new RegExp(`\\b${word}\\b`).test(imported), `${word} is imported from node:test`).toBe(true);
    }

    const result = await indexTestFile("test/api.test.mjs", text);
    expect(result).toStrictEqual(golden);
    const index = expectContract(result);
    const at = (line: number) => index.tests.filter((b) => b.line === line);
    const byPath = (path: string[]) => index.tests.find((b) => JSON.stringify(b.path) === JSON.stringify(path));

    // Subtests two levels deep: a test whose parent and grandparent are tests.
    const deep = index.tests.filter((b) => {
      const parent = byPath(b.path.slice(0, -1));
      const grandparent = byPath(b.path.slice(0, -2));
      return b.kind === "test" && parent?.kind === "test" && grandparent?.kind === "test";
    });
    expect(deep.length, "a subtest two levels deep").toBeGreaterThan(0);
    for (const line of linesMatching(text, /^\s*\w+\.test\(/)) {
      expect(at(line).some((b) => b.kind === "test" && b.path.length >= 2)).toBe(true);
    }
    // it.todo('later'): a test with the todo modifier and no callback.
    for (const line of linesMatching(text, /\bit\.todo\(\s*(["'])later\1\s*\)/)) {
      expect(at(line)).toContainEqual(
        expect.objectContaining({ kind: "test", name: "later", nameDynamic: false, modifiers: ["todo"], body: "" }),
      );
    }
    // node:test words: suite is a describe, before and after are hooks.
    for (const line of linesMatching(text, /^\s*suite\(/))
      expect(at(line).some((b) => b.kind === "describe")).toBe(true);
    for (const word of ["before", "after"]) {
      for (const line of linesMatching(text, new RegExp(`^\\s*${word}\\(`))) {
        expect(at(line).some((b) => b.kind === "hook" && b.name === word)).toBe(true);
      }
    }
    const chains = index.tests.flatMap((b) => b.assertions.map((a) => a.chain));
    expect(chains).toContain("assert()");
    expect(chains).toContain("assert.strictEqual()");
    expect(chains).toContain("assert.strict.equal()");
    expect(chains).toContain("t.assert.ok()");
  });
});
