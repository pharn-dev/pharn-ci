import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// indexTestFile is loaded inside the test body: the AC tests are written before the test index exists, so nothing the
// build adds may run while the file loads. The fixture and its golden are written by the build, so the test also
// checks that the fixture holds every form AC-5 lists and pins the rules inline: a golden fitted to the output cannot
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

/** The SPEC's contract, checked on every block and assertion of an index. */
function expectContract(result: Result): Index {
  if (!result.parsed) throw new Error(`expected an index, got the refusal ${JSON.stringify(result)}`);
  expect(Object.keys(result).sort()).toEqual(["mocks", "parsed", "syntaxErrors", "tests"]);
  let previous = 0;
  for (const b of result.tests) {
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
    expect(b.line).toBeGreaterThanOrEqual(Math.max(previous, 1));
    previous = b.line;
    expect(b.endLine).toBeGreaterThanOrEqual(b.line);
    expect(b.path.at(-1)).toBe(b.name);
    expect(b.modifiers).toEqual(MODIFIERS.filter((m) => b.modifiers.includes(m)));
    if (b.body.length < 4000) expect(b.bodyHash).toBe(fnv1a(b.body));
    expect(b.assertionCount).toBe(b.assertions.length);
    let previousAssertion = b.line;
    for (const a of b.assertions) {
      expect(Object.keys(a).sort()).toEqual(["afterEarlyReturn", "awaited", "chain", "inTryCatch", "line"]);
      expect(a.line).toBeGreaterThanOrEqual(previousAssertion);
      expect(a.line).toBeLessThanOrEqual(b.endLine);
      previousAssertion = a.line;
    }
  }
  return result;
}

const BARE_EXPECT = /^\s*expect\(\s*\w+\s*\);/;
const EXTEND = /\bexpect\.extend\(\s*\{/;

/** Every form AC-5 lists, as it appears in the fixture text. */
const FORMS: [string, RegExp][] = [
  ["chai expect(x).to.be.true", /\bexpect\(\s*\w+\s*\)\.to\.be\.true\b/],
  ["chai expect(x).to.deep.equal(y)", /\bexpect\(\s*\w+\s*\)\.to\.deep\.equal\(/],
  ["x.should.equal(1)", /\b\w+\.should\.equal\(\s*1\s*\)/],
  ["x.should.be.ok", /\b\w+\.should\.be\.ok\b/],
  ["a bare expect(x);", new RegExp(BARE_EXPECT.source, "m")],
  ["expect.extend({…})", EXTEND],
  [
    "expect(a).toEqual(expect.objectContaining({…}))",
    /\bexpect\(\s*\w+\s*\)\.toEqual\(\s*expect\.objectContaining\(\s*\{/,
  ],
  ["a helper function declared in a test body", /^\s+function\s+\w+\s*\(/m],
  ["a catch block", /\bcatch\s*(?:\(\s*\w*\s*\))?\s*\{/],
  ["a return", /\breturn\b/],
];

describe("indexTestFile on the assertion-forms fixture", () => {
  it("AC-5: indexes forms.test.ts to its golden forms.index.json", async () => {
    const text = fixture("ts-index/assertions/forms.test.ts.txt");
    const golden = JSON.parse(fixture("ts-index/assertions/forms.index.json")) as unknown;
    for (const [form, re] of FORMS) expect(re.test(text), `the fixture holds ${form}`).toBe(true);

    const result = await indexTestFile("src/forms.test.ts", text);
    expect(result).toStrictEqual(golden);
    const index = expectContract(result);
    const assertions = index.tests.flatMap((b) => b.assertions);
    const chains = assertions.map((a) => a.chain);

    // Chai and should chains, written from their root with () per argument list.
    expect(chains).toContain("expect().to.be.true");
    expect(chains).toContain("expect().to.deep.equal()");
    expect(chains).toContain("should.equal()");
    expect(chains).toContain("should.be.ok");
    expect(chains).toContain("expect().toEqual()");
    // Not assertions: a bare expect(x), expect.extend and the asymmetric matcher inside toEqual.
    expect(chains).not.toContain("expect()");
    expect(chains.some((c) => c.startsWith("expect.extend"))).toBe(false);
    expect(chains.some((c) => c.includes("objectContaining"))).toBe(false);
    for (const re of [BARE_EXPECT, EXTEND]) {
      for (const line of linesMatching(text, re)) {
        expect(
          assertions.filter((a) => a.line === line),
          `no assertion at line ${line}`,
        ).toEqual([]);
      }
    }
    // An assertion after a return inside a nested function.
    expect(assertions.some((a) => a.afterEarlyReturn)).toBe(true);
    // An assertion outside every block is in the fixture and is not recorded.
    const outside = linesMatching(text, /\bexpect\(\s*\w*\s*\)\.\w|\.should\.\w/).filter(
      (line) => !index.tests.some((b) => b.line <= line && line <= b.endLine),
    );
    expect(outside.length, "an assertion outside every block").toBeGreaterThan(0);
    for (const line of outside) expect(assertions.some((a) => a.line === line)).toBe(false);
  });
});
