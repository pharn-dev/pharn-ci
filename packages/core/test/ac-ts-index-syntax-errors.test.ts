import { describe, expect, it } from "vitest";

// indexTestFile is loaded inside each test body: the AC tests are written before the test index exists, so nothing
// the build adds may run while the file loads.

type Result =
  | { parsed: true; syntaxErrors: number; tests: { kind: string; name: string }[] }
  | { parsed: false; reason: string };

async function indexTestFile(path: string, text: string): Promise<Result> {
  const core = (await import("@pharn-ci/core")) as unknown as { indexTestFile: (p: unknown, t: unknown) => unknown };
  return core.indexTestFile(path, text) as Result;
}

const TWO_TESTS_ONE_ERROR = [
  'it("first", () => {',
  "  expect(1).toBe(1);",
  "});",
  "const = ;",
  'it("second", () => {',
  "  expect(2).toBe(2);",
  "});",
  "",
].join("\n");

describe("indexTestFile syntax errors", () => {
  it("AC-10: indexes a file with one syntax error between two tests, keeping both", async () => {
    const result = await indexTestFile("src/broken.test.ts", TWO_TESTS_ONE_ERROR);
    if (!result.parsed) throw new Error(`refused: ${JSON.stringify(result)}`);
    expect(result.syntaxErrors).toBe(1);
    expect(result.tests.map((b) => [b.kind, b.name])).toEqual([
      ["test", "first"],
      ["test", "second"],
    ]);
  });

  it("AC-10: refuses 11 lines of `const = ;` as syntax-error-heavy", async () => {
    const text = "const = ;\n".repeat(11);
    expect(await indexTestFile("src/broken.test.ts", text)).toStrictEqual({
      parsed: false,
      reason: "syntax-error-heavy",
    });
  });

  it("AC-10: refuses 4096 control characters as syntax-error-heavy", async () => {
    const text = Array.from({ length: 4096 }, (_, i) => String.fromCharCode(i % 32)).join("");
    expect(text.length).toBe(4096);
    expect(await indexTestFile("src/broken.test.ts", text)).toStrictEqual({
      parsed: false,
      reason: "syntax-error-heavy",
    });
  });
});
