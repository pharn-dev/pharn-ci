import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI06 exists, so nothing that depends on it may
// run while the file loads. The texts are generated here: every test changes toBe(5) to toBeTruthy(), and its body is
// full of what a scanner of test text can stall on: many unbalanced `.toThrow(` openings inside string literals, quote
// characters a literal-unaware scan reads as unterminated, a real toThrow assertion to make the argument reader run,
// and deep bracket nesting. The files are valid TypeScript, so the test index parses them. Besides the timing, the test
// checks that TI06 ran (findings on the file), so a check that skips the files cannot pass it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/big.test.ts";
const FULL = 524_288;
const QUARTER = FULL / 4;
const CEILING_MS = 15_000;
const HEADER = 'import { expect, it } from "vitest";\n\n';
const OPEN = ".toThrow(".repeat(12);
const DEEP = 40;

/** One test: `assertion` is `toBe(5)` at base and `toBeTruthy()` at head. */
function testText(n: number, assertion: string): string {
  return [
    `it("case ${n}", () => {`,
    `  const open${n} = "x${OPEN} ((([[[{{{ ' \` ${OPEN}";`,
    `  const quotes${n} = [/'/, /"/, /\`/, /'/, /"/];`,
    `  const deep${n} = ${"[".repeat(DEEP)}${n}${"]".repeat(DEEP)};`,
    `  expect(() => run${n}(open${n}, quotes${n}, deep${n})).toThrow(TypeError);`,
    `  expect(total${n}()).${assertion};`,
    "});",
    "",
  ].join("\n");
}

/** A base and a head test file of the same tests, the larger of the two at most `bytes` bytes (ASCII). */
function generate(bytes: number): { base: string; head: string; count: number } {
  let base = HEADER;
  let head = HEADER;
  let count = 0;
  for (;;) {
    const b = testText(count, "toBe(5)");
    const h = testText(count, "toBeTruthy()");
    if (base.length + b.length > bytes || head.length + h.length > bytes) break;
    base += b;
    head += h;
    count++;
  }
  return { base, head, count };
}

function input(bytes: number) {
  const { base, head, count } = generate(bytes);
  const baseLines = base.split("\n");
  const headLines = head.split("\n");
  const at = baseLines.findIndex((line) => line.endsWith(".toBe(5);"));
  const diff = [
    `diff --git a/${PATH} b/${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${PATH}`,
    `+++ b/${PATH}`,
    `@@ -${at + 1} +${at + 1} @@`,
    `-${baseLines[at]}`,
    `+${headLines[at]}`,
    "",
  ].join("\n");
  return {
    data: {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [PATH, "src/cart.ts"],
      testSources: {
        base: { files: [{ path: PATH, text: base }], dropped: [] },
        head: { files: [{ path: PATH, text: head }], dropped: [] },
      },
      testIntegrityMode: { input: "block" },
    },
    sizes: { base: base.length, head: head.length, count },
  };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

describe("TI06: the comparison of one file grows less than eightfold from a quarter of the cap", () => {
  it("AC-17: 512 KiB base and head files full of unbalanced toThrow( openings, unterminated quotes and deep nesting give TI06 findings, take less than 8 times the median of 128 KiB ones, and finish each run within 15 s", async () => {
    const { check } = await import("../src/check.js");
    type Input = Parameters<typeof check>[0];
    const full = input(FULL);
    const quarter = input(QUARTER);
    for (const [run, bytes] of [
      [full, FULL],
      [quarter, QUARTER],
    ] as const) {
      expect(run.sizes.base).toBeLessThanOrEqual(bytes);
      expect(run.sizes.head).toBeLessThanOrEqual(bytes);
      expect(Math.max(run.sizes.base, run.sizes.head), "the larger file fills the size").toBeGreaterThan(bytes - 400);
      expect(run.sizes.count).toBeGreaterThan(100);
    }
    // The generated files are valid TypeScript: the existing test index parses them with no syntax error.
    const core = (await import("@pharn-ci/core")) as unknown as {
      indexTestFile(path: string, text: string): { parsed: boolean; syntaxErrors?: number };
    };
    for (const run of [full, quarter]) {
      for (const side of [run.data.testSources.base, run.data.testSources.head]) {
        const result = core.indexTestFile(PATH, (side.files[0] as { text: string }).text);
        expect(result.parsed, JSON.stringify(result)).toBe(true);
        expect(result.syntaxErrors).toBe(0);
      }
    }

    const all: number[] = [];
    const time = (run: ReturnType<typeof input>) => {
      const started = performance.now();
      const report = check(run.data as unknown as Input) as unknown as {
        testIntegrity: { signals: { id: string; path: string }[]; languages: string[] };
      };
      const ms = performance.now() - started;
      all.push(ms);
      const ti06 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
      expect(ti06.length, "the run gives TI06 findings").toBeGreaterThan(0);
      expect(ti06.every((s) => s.path === PATH)).toBe(true);
      return { ms, report };
    };

    for (const run of [full, quarter]) {
      const warm = time(run);
      expectValidReport(warm.report);
      expect(warm.report.testIntegrity.languages, "the file was indexed").toEqual(["ts"]);
    }
    const fullRuns = [time(full).ms, time(full).ms, time(full).ms];
    const quarterRuns = [time(quarter).ms, time(quarter).ms, time(quarter).ms];

    expect(median(fullRuns), `full ${fullRuns.join(", ")} ms vs quarter ${quarterRuns.join(", ")} ms`).toBeLessThan(
      8 * median(quarterRuns),
    );
    for (const ms of all) expect(ms, "every run finishes within 15 s").toBeLessThan(CEILING_MS);
  }, 240_000);
});
