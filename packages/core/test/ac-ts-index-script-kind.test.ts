import { describe, expect, it } from "vitest";

// indexTestFile is loaded inside the test body: the AC tests are written before the test index exists, so nothing the
// build adds may run while the file loads.

type Result = { parsed: true; syntaxErrors: number } | { parsed: false; reason: string };

async function indexTestFile(path: string, text: string): Promise<Result> {
  const core = (await import("@pharn-ci/core")) as unknown as { indexTestFile: (p: unknown, t: unknown) => unknown };
  return core.indexTestFile(path, text) as Result;
}

const JSX_TEXT = "const el = <div>{x}</div>;";
const GENERIC_ARROW = "const id = <T>(x: T) => x;";

/** Every path of AC-6 and whether the JSX text and the generic arrow parse without a syntax error under it. */
const PATHS: [path: string, jsxClean: boolean, genericClean: boolean | null][] = [
  ["src/a.test.ts", false, true],
  ["src/a.test.mts", false, true],
  ["src/a.test.cts", false, true],
  ["src/a.test.tsx", true, false],
  ["src/a.test.TSX", true, false],
  ["src/a.test.js", true, null],
  ["src/a.test.mjs", true, null],
  ["src/a.test.cjs", true, null],
  ["src/a.test.jsx", true, false],
  ["src/a_test.py", false, true],
  ["src/Makefile", false, true],
];

describe("indexTestFile script kind by extension", () => {
  it.each(PATHS)("AC-6: picks the script kind from the extension of %s", async (path, jsxClean, genericClean) => {
    const jsx = await indexTestFile(path, JSX_TEXT);
    if (!jsx.parsed) throw new Error(`the JSX text was refused under ${path}: ${JSON.stringify(jsx)}`);
    if (jsxClean) expect(jsx.syntaxErrors, `JSX under ${path}`).toBe(0);
    else expect(jsx.syntaxErrors, `JSX under ${path}`).toBeGreaterThanOrEqual(1);

    const generic = await indexTestFile(path, GENERIC_ARROW);
    if (!generic.parsed) throw new Error(`the generic arrow was refused under ${path}: ${JSON.stringify(generic)}`);
    if (genericClean === true) expect(generic.syntaxErrors, `generic arrow under ${path}`).toBe(0);
    if (genericClean === false) expect(generic.syntaxErrors, `generic arrow under ${path}`).toBeGreaterThanOrEqual(1);
  });
});
