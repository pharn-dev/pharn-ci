import { MAX_TEST_SOURCE_FILE_BYTES } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";

// indexTestFile is loaded inside each test body: the AC tests are written before the test index exists, so nothing
// the build adds may run while the file loads. All timing and heap measurement lives here, never in packages/core/src.

type Block = { kind: string; assertionCount: number };
type Result = { parsed: true; tests: Block[] } | { parsed: false; reason: string };
type IndexFn = (path: unknown, text: unknown) => unknown;

async function loadIndexTestFile(): Promise<IndexFn> {
  const core = (await import("@pharn-ci/core")) as unknown as { indexTestFile: IndexFn };
  if (typeof core.indexTestFile !== "function") throw new Error("indexTestFile is not exported from @pharn-ci/core");
  return core.indexTestFile;
}

// The reader caps a test file at this many bytes; a file within it has at most as many UTF-16 code units, so the
// index's character cap of the same number never refuses a file the reader kept.
const CAP = MAX_TEST_SOURCE_FILE_BYTES;
// A wall-clock budget measures the machine (v8 coverage on a CI runner is several times slower than a laptop), so
// the time checks are a growth ratio between a quarter-size and a full-size input of the same shape, plus a loose
// ceiling that only catches a hang. Linear work gives a ratio near 4, quadratic work near 16.
const MAX_GROWTH = 8;
const HANG_CEILING_MS = 15_000;
const HEAP_BOUND = 256 * 1024 * 1024;
const TIMEOUT = 60_000;

/** Tests of one assertion each, then a block comment, to exactly `length` characters. */
function capFile(length: number): string {
  const lines: string[] = [];
  let size = 0;
  for (let i = 0; size < length - 200; i++) {
    const line = `it("t${i}", () => {\n  expect(${i}).toBe(${i});\n});\n`;
    lines.push(line);
    size += line.length;
  }
  const head = lines.join("");
  const text = `${head}/*${"x".repeat(length - head.length - 4)}*/`;
  expect(text.length).toBe(length);
  return text;
}

/** `count` lines of exactly `width` characters (the newline included), each one test with one assertion. */
function wideLines(count: number, width: number): string {
  return Array.from({ length: count }, (_, i) => {
    const code = `it("w${i}", () => { expect(${i}).toBe(${i}); }); //`;
    return `${code}${"x".repeat(width - code.length - 1)}\n`;
  }).join("");
}

function manyTests(count: number): string {
  return Array.from({ length: count }, (_, i) => `it("t${i}", () => {\n  expect(${i}).toBe(${i});\n});\n`).join("");
}

function thousandTests(): string {
  return manyTests(1000);
}

/** One input shape at a quarter of its size and at its full size. */
const GROWTH: [label: string, quarter: () => string, full: () => string][] = [
  ["the 524,288-character test file", () => capFile(CAP / 4), () => capFile(CAP)],
  ["1300 lines of 400 characters", () => wideLines(325, 400), () => wideLines(1300, 400)],
  ["1000 it blocks of one assertion each", () => manyTests(250), thousandTests],
];

const INPUTS: [label: string, make: () => string][] = [
  ["the 524,288-character test file", () => capFile(CAP)],
  ["1300 lines of 400 characters", () => wideLines(1300, 400)],
  ["1000 it blocks of one assertion each", thousandTests],
  ["5000 lines of 400 characters", () => wideLines(5000, 400)],
  ["10,000 nested arrow functions", () => `${"x=>".repeat(10_000)}x`],
  ["10,000 nested parentheses", () => `${"(".repeat(10_000)}1${")".repeat(10_000)}`],
  ["10,000 nested array brackets", () => `${"[".repeat(10_000)}1${"]".repeat(10_000)}`],
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/** The median wall time of three runs of indexing `text`, checking each result is an index or a refusal. */
function medianTime(indexTestFile: IndexFn, text: string): number {
  const times: number[] = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const result = indexTestFile("src/limits.test.ts", text) as Result;
    times.push(performance.now() - start);
    expect(typeof result.parsed).toBe("boolean");
  }
  return median(times);
}

describe("indexTestFile limits", () => {
  it.each(INPUTS)(
    "AC-12: indexes %s three times with a median under the hang ceiling",
    async (_label, make) => {
      const indexTestFile = await loadIndexTestFile();
      expect(medianTime(indexTestFile, make())).toBeLessThan(HANG_CEILING_MS);
    },
    TIMEOUT,
  );

  it.each(GROWTH)(
    "AC-12: indexing %s takes less than 8 times as long as a quarter of it",
    async (label, quarter, full) => {
      const indexTestFile = await loadIndexTestFile();
      const small = quarter();
      const large = full();
      // Warm up, so the JIT compiling the parser does not land on the small input's runs.
      indexTestFile("src/limits.test.ts", small);
      const smallMs = medianTime(indexTestFile, small);
      const largeMs = medianTime(indexTestFile, large);
      const growth = largeMs / Math.max(smallMs, 1);
      expect(growth, `${label}: ${largeMs.toFixed(1)} ms vs ${smallMs.toFixed(1)} ms`).toBeLessThan(MAX_GROWTH);
    },
    TIMEOUT,
  );

  it(
    "AC-12: the 1000-test file yields 1000 tests each with assertionCount 1",
    async () => {
      const indexTestFile = await loadIndexTestFile();
      const result = indexTestFile("src/limits.test.ts", thousandTests()) as Result;
      if (!result.parsed) throw new Error(`refused: ${JSON.stringify(result)}`);
      expect(result.tests.length).toBe(1000);
      expect(result.tests.every((b) => b.kind === "test" && b.assertionCount === 1)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "AC-12: the heap in use grows by less than 256 MiB across indexing the 524,288-character file",
    async () => {
      const indexTestFile = await loadIndexTestFile();
      const text = capFile(CAP);
      const before = process.memoryUsage().heapUsed;
      const result = indexTestFile("src/limits.test.ts", text) as Result;
      const after = process.memoryUsage().heapUsed;
      expect(result.parsed).toBe(true);
      expect(after - before).toBeLessThan(HEAP_BOUND);
    },
    TIMEOUT,
  );
});
