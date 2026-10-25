import { describe, expect, it } from "vitest";

// indexTestFile is loaded inside each test body: the AC tests are written before the test index exists, so nothing
// the build adds may run while the file loads.

type Result = { parsed: true; tests: { kind: string; name: string }[] } | { parsed: false; reason: string };

async function indexTestFile(path: string, text: string): Promise<Result> {
  const core = (await import("@pharn-ci/core")) as unknown as { indexTestFile: (p: unknown, t: unknown) => unknown };
  return core.indexTestFile(path, text) as Result;
}

const CAP = 524_288;
const HEAD = 'it("one", () => {\n  expect(1).toBe(1);\n});\n';

/** One `it` block padded with a block comment to exactly `length` characters. */
function padded(length: number): string {
  const text = `${HEAD}/*${"x".repeat(length - HEAD.length - 4)}*/`;
  expect(text.length).toBe(length);
  return text;
}

describe("indexTestFile size cap", () => {
  it("AC-8: indexes a test file of exactly 524,288 characters", async () => {
    const result = await indexTestFile("src/big.test.ts", padded(CAP));
    if (!result.parsed) throw new Error(`refused at the cap: ${JSON.stringify(result)}`);
    expect(result.tests.length).toBe(1);
    expect(result.tests[0]).toMatchObject({ kind: "test", name: "one" });
  });

  it("AC-8: refuses one character over the cap as too-large", async () => {
    expect(await indexTestFile("src/big.test.ts", padded(CAP + 1))).toStrictEqual({
      parsed: false,
      reason: "too-large",
    });
  });

  it("AC-8: refuses 5000 lines of 400 characters as too-large", async () => {
    const text = `// ${"x".repeat(396)}\n`.repeat(5000);
    expect(text.length).toBe(2_000_000);
    expect(await indexTestFile("src/big.test.ts", text)).toStrictEqual({ parsed: false, reason: "too-large" });
  });
});
