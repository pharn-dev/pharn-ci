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
const BUDGET_MS = 2000;
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

function thousandTests(): string {
  return Array.from({ length: 1000 }, (_, i) => `it("t${i}", () => {\n  expect(${i}).toBe(${i});\n});\n`).join("");
}

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

describe("indexTestFile limits", () => {
  it.each(INPUTS)(
    "AC-12: indexes %s three times with a median under 2000 ms",
    async (_label, make) => {
      const indexTestFile = await loadIndexTestFile();
      const text = make();
      const times: number[] = [];
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        const result = indexTestFile("src/limits.test.ts", text) as Result;
        times.push(performance.now() - start);
        expect(typeof result.parsed).toBe("boolean");
      }
      expect(median(times)).toBeLessThan(BUDGET_MS);
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
