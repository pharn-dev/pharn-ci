import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// indexTestFile is loaded inside the test body: the AC tests are written before the test index exists, so nothing the
// build adds may run while the file loads. The fixture and its golden are written by the build, so the test also
// checks that the fixture holds every form AC-4 lists and pins the rules inline: a golden fitted to the output cannot
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

/** The SPEC's contract, checked on every block and assertion of an index. */
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

const STEP = /\btest\.step\(\s*(["'])fill\1/;
const CONFIGURE = /\btest\.describe\.configure\(\s*\{\s*mode:\s*(["'])serial\1\s*\}\s*\)/;
const IN_BODY_SKIP = /\btest\.skip\(\s*browserName\s*===\s*(["'])webkit\1\s*,\s*(["'])reason\2\s*\)/;

/** Every form AC-4 lists, as it appears in the fixture text. */
const FORMS: [string, RegExp][] = [
  ["test.describe", /\btest\.describe\(/],
  ["test.describe.serial", /\btest\.describe\.serial\(/],
  ["test.describe.only", /\btest\.describe\.only\(/],
  ["test.describe.configure({ mode: 'serial' })", CONFIGURE],
  ["test.beforeEach", /\btest\.beforeEach\(/],
  ["test.step('fill', …)", STEP],
  ["an in-body test.skip(browserName === 'webkit', 'reason')", IN_BODY_SKIP],
  ["test.fixme('a', …)", /\btest\.fixme\(\s*(["'])a\1\s*,/],
  ["test.fail('b', …)", /\btest\.fail\(\s*(["'])b\1\s*,/],
  ["await expect(page).toHaveText(…)", /\bawait\s+expect\(\s*page\s*\)\.toHaveText\(/],
  ["expect.soft(…)", /\bexpect\.soft\(/],
  ["await expect.poll(…).toBe(…)", /\bawait\s+expect\.poll\(/],
];

describe("indexTestFile on the playwright fixture", () => {
  it("AC-4: indexes login.spec.ts to its golden login.index.json; step, configure and an in-body skip are not blocks", async () => {
    const text = fixture("ts-index/playwright/login.spec.ts.txt");
    const golden = JSON.parse(fixture("ts-index/playwright/login.index.json")) as unknown;
    for (const [form, re] of FORMS) expect(re.test(text), `the fixture holds ${form}`).toBe(true);

    const result = await indexTestFile("e2e/login.spec.ts", text);
    expect(result).toStrictEqual(golden);
    const index = expectContract(result);
    const at = (line: number) => index.tests.filter((b) => b.line === line);

    // Not blocks: test.step, test.describe.configure and the in-body test.skip.
    expect(index.tests.some((b) => b.name === "fill")).toBe(false);
    for (const re of [STEP, CONFIGURE, IN_BODY_SKIP]) {
      for (const line of linesMatching(text, re)) expect(at(line), `no block at line ${line}`).toEqual([]);
    }
    // The step's assertion belongs to the test around it.
    for (const line of linesMatching(text, STEP)) {
      const around = index.tests
        .filter((b) => b.kind === "test" && b.line < line && b.endLine >= line)
        .sort((x, y) => y.line - x.line)[0];
      expect(around, `a test around the step at line ${line}`).toBeDefined();
      expect(around?.assertions.some((a) => a.line > line)).toBe(true);
    }
    // Playwright describes and hooks, fixme as skip and fail as fails.
    for (const line of linesMatching(text, /^\s*test\.describe\(/)) {
      expect(at(line).some((b) => b.kind === "describe")).toBe(true);
    }
    for (const line of linesMatching(text, /^\s*test\.describe\.serial\(/)) {
      expect(at(line)).toContainEqual(expect.objectContaining({ kind: "describe", modifiers: [] }));
    }
    for (const line of linesMatching(text, /^\s*test\.describe\.only\(/)) {
      expect(at(line)).toContainEqual(expect.objectContaining({ kind: "describe", modifiers: ["only"] }));
    }
    for (const line of linesMatching(text, /^\s*test\.beforeEach\(/)) {
      expect(at(line)).toContainEqual(expect.objectContaining({ kind: "hook", name: "beforeEach" }));
    }
    expect(index.tests).toContainEqual(expect.objectContaining({ kind: "test", name: "a", modifiers: ["skip"] }));
    expect(index.tests).toContainEqual(expect.objectContaining({ kind: "test", name: "b", modifiers: ["fails"] }));
    // Assertions.
    const assertions = index.tests.flatMap((b) => b.assertions);
    expect(assertions).toContainEqual(expect.objectContaining({ chain: "expect().toHaveText()", awaited: true }));
    expect(assertions.some((a) => /^expect\.soft\(\)\./.test(a.chain))).toBe(true);
    expect(assertions).toContainEqual(expect.objectContaining({ chain: "expect.poll().toBe()", awaited: true }));
  });
});
