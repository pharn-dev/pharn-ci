import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside each test body: these tests are written before it exists, so nothing the build
// adds may run while the file loads. The real interpreter runs; a missing python3 fails the test. Each generated
// input fits the 512 KiB cap (the nested ifs indent one space per level), so it reaches the parser.

const CEILING_MS = 15_000;
const SLOW = 60_000;

type Result = { parsed: true } | { parsed: false; reason: string };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };

const DEEP: [label: string, text: string][] = [
  ["5000 nested parentheses", `def test_deep():\n    x = ${"(".repeat(5000)}1${")".repeat(5000)}\n`],
  [
    "1000 nested if blocks",
    `def test_deep():\n${Array.from({ length: 1000 }, (_, k) => `${" ".repeat(k + 1)}if x:\n`).join("")}${" ".repeat(1001)}pass\n`,
  ],
  ["an attribute chain of 100,000 parts", `def test_deep():\n    y = x${".a".repeat(99_999)}\n`],
  ["a not chain of 50,000 operators", `def test_deep():\n    y = ${"not ".repeat(50_000)}x\n`],
];

describe("indexPythonTests: inputs too deep for the parser", () => {
  it.each(DEEP)(
    "AC-10: refuses %s as too-deep, within 15 s",
    async (_label, text) => {
      const io = (await import("../src/index.js")) as unknown as {
        indexPythonTests: (files: { path: string; text: string }[]) => Promise<Run>;
      };
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(524_288);

      const started = performance.now();
      const run = await io.indexPythonTests([{ path: "tests/test_deep.py", text }]);
      const elapsed = performance.now() - started;

      if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
      expect(run.files.map((f) => f.path)).toEqual(["tests/test_deep.py"]);
      expect(run.files[0]?.result).toStrictEqual({ parsed: false, reason: "too-deep" });
      expect(elapsed, "the run returns within 15 s").toBeLessThan(CEILING_MS);
    },
    SLOW,
  );
});
