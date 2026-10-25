import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// indexTestFile is loaded inside each test body: the AC tests are written before the test index exists, so nothing
// the build adds may run while the file loads.

type Block = { kind: string; name: string; path: string[] };
type Result = { parsed: true; tests: Block[] } | { parsed: false; reason: string };

async function indexTestFile(path: string, text: string): Promise<Result> {
  const core = (await import("@pharn-ci/core")) as unknown as { indexTestFile: (p: unknown, t: unknown) => unknown };
  return core.indexTestFile(path, text) as Result;
}

const DEEP_TEXTS: [label: string, text: string][] = [
  ["10,000 nested arrow functions", `${"x=>".repeat(10_000)}x`],
  ["10,000 nested parentheses", `${"(".repeat(10_000)}1${")".repeat(10_000)}`],
  ["10,000 nested array brackets", `${"[".repeat(10_000)}1${"]".repeat(10_000)}`],
];

/** 100 describe blocks nested in each other, named d0 to d99, with one `it` named leaf in the innermost. */
function nestedDescribes(): string {
  const open = Array.from({ length: 100 }, (_, i) => `describe("d${i}", () => {\n`).join("");
  return `${open}it("leaf", () => {\n  expect(1).toBe(1);\n});\n${"});\n".repeat(100)}`;
}

describe("indexTestFile depth refusal", () => {
  it.each(DEEP_TEXTS)("AC-9: refuses %s as too-deep", async (_label, text) => {
    expect(await indexTestFile("src/deep.test.ts", text)).toStrictEqual({ parsed: false, reason: "too-deep" });
  });

  it("AC-9: indexes 100 nested describe blocks, and the vitest fixture still matches its golden afterwards", async () => {
    for (const [, text] of DEEP_TEXTS) await indexTestFile("src/deep.test.ts", text);

    const result = await indexTestFile("src/deep.test.ts", nestedDescribes());
    if (!result.parsed) throw new Error(`the nested describes were refused: ${JSON.stringify(result)}`);
    expect(result.tests.length).toBe(101);
    expect(result.tests.filter((b) => b.kind === "describe").length).toBe(100);
    const leaf = result.tests.find((b) => b.kind === "test");
    expect(leaf?.path).toEqual([...Array.from({ length: 100 }, (_, i) => `d${i}`), "leaf"]);
    expect(leaf?.path.length).toBe(101);

    const text = fixture("ts-index/vitest/math.test.ts.txt");
    const golden = JSON.parse(fixture("ts-index/vitest/math.index.json")) as unknown;
    expect(await indexTestFile("src/math.test.ts", text)).toStrictEqual(golden);
  });
});
