import { describe, expect, it } from "vitest";

// indexPythonTests and MAX_TEST_SOURCE_FILE_BYTES are loaded inside each test body: these tests are written before
// indexPythonTests exists, so nothing the build adds may run while the file loads. The real interpreter runs; a
// missing python3 fails the test. Timing is asserted as growth (full size over quarter size, medians of three after a
// warm-up) and a loose 15 s ceiling, never a fixed budget tuned on one machine.

const CEILING_MS = 15_000;
const MAX_RATIO = 8;
const SLOW = 180_000;

type Result = { parsed: true; tests: unknown[] } | { parsed: false; reason: string };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };

/** A valid Python test file of exactly `bytes` UTF-8 bytes: test functions, then a comment line to pad. */
function sizedTests(bytes: number): string {
  let text = "";
  for (let i = 0; ; i++) {
    const unit = `def test_${String(i).padStart(6, "0")}():\n    assert value(${i}) == ${i}  # check\n`;
    if (text.length + unit.length + 2 > bytes) break;
    text += unit;
  }
  const rest = bytes - text.length;
  return `${text}#${"x".repeat(rest - 2)}\n`;
}

const parens = (n: number) => `def test_deep():\n    x = ${"(".repeat(n)}1${")".repeat(n)}\n`;
const ifs = (n: number) =>
  `def test_deep():\n${Array.from({ length: n }, (_, k) => `${" ".repeat(k + 1)}if x:\n`).join("")}${" ".repeat(n + 1)}pass\n`;
const attributes = (n: number) => `def test_deep():\n    y = x${".a".repeat(n - 1)}\n`;
const nots = (n: number) => `def test_deep():\n    y = ${"not ".repeat(n)}x\n`;

/** Each input as a function of its full size, and that full size. */
const INPUTS: [label: string, make: (n: number) => string, full: number | "cap"][] = [
  ["a valid test file of exactly 524,288 bytes", sizedTests, "cap"],
  ["5000 nested parentheses", parens, 5000],
  ["1000 nested if blocks", ifs, 1000],
  ["an attribute chain of 100,000 parts", attributes, 100_000],
  ["a not chain of 50,000 operators", nots, 50_000],
];

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

describe("indexPythonTests: growth from quarter to full size", () => {
  it.each(INPUTS)(
    "AC-11: %s grows by less than 8 times from a quarter of its size, each run within 15 s",
    async (label, make, size) => {
      const io = (await import("../src/index.js")) as unknown as {
        indexPythonTests: (files: { path: string; text: string }[]) => Promise<Run>;
      };
      const core = (await import("@pharn-ci/core")) as unknown as { MAX_TEST_SOURCE_FILE_BYTES: number };
      const cap = core.MAX_TEST_SOURCE_FILE_BYTES;
      expect(cap).toBe(524_288);
      const full = size === "cap" ? cap : size;
      const fullText = make(full);
      const quarterText = make(Math.floor(full / 4));
      expect(Buffer.byteLength(fullText)).toBeLessThanOrEqual(cap);
      if (size === "cap") expect(Buffer.byteLength(fullText)).toBe(cap);

      const timed = async (text: string) => {
        const started = performance.now();
        const run = await io.indexPythonTests([{ path: "tests/test_growth.py", text }]);
        const elapsed = performance.now() - started;
        if (!run.available) throw new Error(`${label}: the run is unavailable: ${JSON.stringify(run)}`);
        expect(elapsed, `${label}: a run returns within 15 s`).toBeLessThan(CEILING_MS);
        return { elapsed, result: (run.files[0] as { result: Result }).result };
      };

      const warm = await timed(fullText);
      if (size === "cap") {
        if (!warm.result.parsed) throw new Error(`the 524,288-byte file was refused: ${JSON.stringify(warm.result)}`);
        expect(warm.result.tests.length).toBeGreaterThan(1000);
      }
      const quarters: number[] = [];
      const fulls: number[] = [];
      for (let round = 0; round < 3; round++) {
        quarters.push((await timed(quarterText)).elapsed);
        fulls.push((await timed(fullText)).elapsed);
      }
      const ratio = median(fulls) / median(quarters);
      expect(
        ratio,
        `${label}: median full ${median(fulls)} ms over median quarter ${median(quarters)} ms`,
      ).toBeLessThan(MAX_RATIO);
    },
    SLOW,
  );
});
