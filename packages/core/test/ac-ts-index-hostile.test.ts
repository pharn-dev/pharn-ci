import { describe, expect, it } from "vitest";

// indexTestFile is loaded inside each test body: the AC tests are written before the test index exists, so nothing
// the build adds may run while the file loads.

type Block = { name: string; path: string[] };
type Result = { parsed: true; tests: Block[] } | { parsed: false; reason: string };

const REASONS = ["syntax-error-heavy", "too-large", "too-deep", "parser-threw"];

async function indexTestFile(path: unknown, text: unknown): Promise<unknown> {
  const core = (await import("@pharn-ci/core")) as unknown as { indexTestFile: (p: unknown, t: unknown) => unknown };
  return core.indexTestFile(path, text);
}

const LONG_NAME = "n".repeat(10_000);
const BOM = String.fromCharCode(0xfeff);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const HIGH = String.fromCharCode(0xd800);
const LOW = String.fromCharCode(0xdc00);

/** [label, path, text]: every hostile input AC-11 lists. */
const HOSTILE: [label: string, path: unknown, text: unknown][] = [
  ["the empty string", "src/h.test.ts", ""],
  ["a lone byte order mark", "src/h.test.ts", BOM],
  ["a shebang line", "src/h.test.ts", '#!/usr/bin/env node\nit("a", () => {\n  expect(1).toBe(1);\n});\n'],
  ["lone surrogates", `src/${HIGH}h.test.ts`, `it("${HIGH}", () => {});\nit("x${LOW}", () => {});\n`],
  ["U+2028 and U+2029 inside names", "src/h.test.ts", `it("a${LS}b", () => {});\nit("c${PS}d", () => {});\n`],
  ["an unterminated string", "src/h.test.ts", 'it("abc'],
  ["an unterminated template", "src/h.test.ts", "it(`abc ${x"],
  ["an unterminated regex", "src/h.test.ts", "const r = /abc"],
  ["an unterminated comment", "src/h.test.ts", "/* abc"],
  ["100,000 {", "src/h.test.ts", "{".repeat(100_000)],
  ["a JSX tag in a .ts path", "src/h.test.ts", 'it("a", () => {\n  const e = <div>{x}</div>;\n});\n'],
  [
    "tests named __proto__, constructor and toString",
    "src/h.test.ts",
    'it("__proto__", () => {});\nit("constructor", () => {});\nit("toString", () => {});\n',
  ],
  [
    "a test name of 10,000 characters",
    "src/h.test.ts",
    `describe("${LONG_NAME}", () => {\n  it("${LONG_NAME}", () => {});\n});\n`,
  ],
  ["null as the text", "src/h.test.ts", null],
  ["undefined as the text", "src/h.test.ts", undefined],
  ["42 as the text", "src/h.test.ts", 42],
  ["null as the path", null, 'it("a", () => {});\n'],
  ["undefined as the path", undefined, 'it("a", () => {});\n'],
  ["42 as the path", 42, 'it("a", () => {});\n'],
];

describe("indexTestFile on hostile input", () => {
  it.each(HOSTILE)("AC-11: never throws on %s and returns plain, capped data", async (label, path, text) => {
    let result: unknown;
    let thrown: unknown = null;
    try {
      result = await indexTestFile(path, text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, `${label} threw`).toBeNull();
    const r = result as Result;
    expect([true, false]).toContain(r.parsed);
    if (!r.parsed) {
      expect(Object.keys(r).sort()).toEqual(["parsed", "reason"]);
      expect(REASONS).toContain(r.reason);
    }
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
    if (r.parsed) {
      for (const b of r.tests) {
        expect(b.name.length).toBeLessThanOrEqual(500);
        for (const entry of b.path) expect(entry.length).toBeLessThanOrEqual(500);
      }
    }
    if (typeof path !== "string" || typeof text !== "string") {
      expect(result).toStrictEqual({ parsed: false, reason: "parser-threw" });
    }
  });

  it("AC-11: keeps tests named __proto__, constructor and toString as plain names", async () => {
    const result = (await indexTestFile(
      "src/h.test.ts",
      'it("__proto__", () => {});\nit("constructor", () => {});\nit("toString", () => {});\n',
    )) as Result;
    if (!result.parsed) throw new Error(`refused: ${JSON.stringify(result)}`);
    expect(result.tests.map((b) => b.name)).toEqual(["__proto__", "constructor", "toString"]);
  });

  it("AC-11: cuts a 10,000-character name to 500 characters", async () => {
    const result = (await indexTestFile("src/h.test.ts", `it("${LONG_NAME}", () => {});\n`)) as Result;
    if (!result.parsed) throw new Error(`refused: ${JSON.stringify(result)}`);
    expect(result.tests[0]?.name).toBe("n".repeat(500));
  });
});
