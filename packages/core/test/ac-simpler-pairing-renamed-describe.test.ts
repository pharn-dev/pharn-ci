import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestBlock } from "../src/testIndex/types.js";
import { measureGrowth, threadCpuMs } from "./growth.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-145 part A, AC-5. check(), the test index and the body-token module are loaded inside the test body: the AC test
// is written before the pairing is rebuilt as one bounded loop, so nothing the build changes may run while this file
// loads. The inputs are generated here, never written to fixtures/.
//
// One modified test file whose describe is renamed ("cart" at base, "basket" at head), so no base test keeps its full
// name. Every test's body is also edited (one statement added), so no base test matches a new test by body hash, while
// each matches its counterpart by a body-token Jaccard of at least 4/5. Every base test must be paired (no TI02), and
// skipping the new tests already paired must not make the walk quadratic: the run at a 256 KiB file takes less than 8
// times the run at a 64 KiB file, measured on this thread's CPU time with measureGrowth (growth.ts) after a warm-up run
// of each size, and every run takes under 15 s of CPU time. The prefix index the walk replaces is gone: the module
// bodyTokens.js has no SimilarityIndex export.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const FULL = 262_144;
const QUARTER = FULL / 4;
const CEILING_MS = 15_000;
const IMPORTS = 'import { describe, expect, it } from "vitest";\nimport { createCart } from "./cart.js";\n\n';

const test = (i: number, extra: string) =>
  `  it("adds case ${i}", () => {\n    const cart${i} = createCart("c${i}");\n    cart${i}.add({ sku: "s${i}", price: ${i}, quantity: 2 });\n${extra}    expect(cart${i}.total()).toBe(${2 * i});\n  });\n`;
const baseTest = (i: number) => test(i, "");
const headTest = (i: number) => test(i, `    cart${i}.freeze();\n`);

/** The head file filled to at most `bytes`, and the base file with as many tests under the old describe name. */
function generate(bytes: number) {
  const close = "});\n";
  let head = `// head\n${IMPORTS}describe("basket", () => {\n`;
  let count = 0;
  for (;;) {
    const next = headTest(count);
    if (head.length + next.length + close.length > bytes) break;
    head += next;
    count++;
  }
  head += close;
  let base = `// base\n${IMPORTS}describe("cart", () => {\n`;
  for (let i = 0; i < count; i++) base += baseTest(i);
  base += close;
  const diff = [
    `diff --git a/${PATH} b/${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${PATH}`,
    `+++ b/${PATH}`,
    "@@ -1 +1 @@",
    "-// base",
    "+// head",
    "",
  ].join("\n");
  return {
    base,
    head,
    count,
    data: {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [PATH, "src/cart.ts"],
      testSources: {
        base: { files: [{ path: PATH, text: base }], dropped: [] },
        head: { files: [{ path: PATH, text: head }], dropped: [] },
      },
      testIntegrityMode: { input: "block" as const },
    },
  };
}

async function testsOf(text: string): Promise<TestBlock[]> {
  const { indexTestFile } = await import("../src/testIndex/indexTestFile.js");
  const result = indexTestFile(PATH, text);
  if (!result.parsed) throw new Error(`the generated text does not parse: ${JSON.stringify(result)}`);
  expect(result.syntaxErrors, "the generated text has no syntax error").toBe(0);
  return result.tests.filter((b) => b.kind === "test");
}

describe("a renamed describe keeps every pair, in linear time", () => {
  it("AC-5: a modified file whose renamed describe leaves thousands of tests matched only by body similarity gives no TI02 at 256 KiB and at 64 KiB, each run under 15 s of CPU time, the 256 KiB run under 8 times the 64 KiB run, and bodyTokens.js has no SimilarityIndex export", async () => {
    const { check } = await import("./text-coverage.js");
    const tokens = await import("../src/signals/bodyTokens.js");
    const full = generate(FULL);
    const quarter = generate(QUARTER);
    const least: Record<number, number> = { [FULL]: 1000, [QUARTER]: 250 };
    for (const [run, bytes] of [
      [full, FULL],
      [quarter, QUARTER],
    ] as const) {
      expect(run.head.length).toBeLessThanOrEqual(bytes);
      expect(run.head.length, "the head file fills the size").toBeGreaterThan(bytes - 300);
      expect(run.count, "thousands of tests at 256 KiB, hundreds at 64 KiB").toBeGreaterThan(least[bytes] as number);
      const base = await testsOf(run.base);
      const head = await testsOf(run.head);
      expect(base.length).toBe(run.count);
      expect(head.length).toBe(run.count);
      const baseNames = new Set(base.map((b) => b.path.join(" › ")));
      expect(
        head.filter((b) => baseNames.has(b.path.join(" › "))),
        "the describe is renamed: no full name is kept",
      ).toEqual([]);
      base.forEach((was, i) => {
        const now = head[i] as TestBlock;
        expect(now.bodyHash, `case ${i}: the body hash differs`).not.toBe(was.bodyHash);
        expect(
          tokens.jaccardAtLeast(tokens.bodyTokenSet(was.body), tokens.bodyTokenSet(now.body), tokens.FOUR_FIFTHS),
          `case ${i}: the body-token Jaccard is at least 4/5`,
        ).toBe(true);
      });
    }

    const all: number[] = [];
    const time = (run: ReturnType<typeof generate>): Report => {
      const started = threadCpuMs();
      const report = check(run.data);
      all.push(threadCpuMs() - started);
      expect(
        report.testIntegrity.signals.filter((s) => s.id === "TI02" && s.path === PATH),
        "every base test is paired: no TI02 for the file",
      ).toEqual([]);
      return report;
    };
    for (const run of [full, quarter]) {
      const warm = time(run);
      expectValidReport(warm);
      expect(warm.testIntegrity.languages, "the file was compared").toEqual(["ts"]);
    }
    const growth = await measureGrowth(
      () => time(quarter),
      () => time(full),
    );
    expect(growth.ratio, `256 KiB vs 64 KiB: ${growth.detail}`).toBeLessThan(8);
    for (const ms of all) expect(ms, "every run finishes within 15 s of CPU time").toBeLessThan(CEILING_MS);

    expect(Object.keys(tokens), "the prefix index the bounded walk replaces is gone").not.toContain("SimilarityIndex");
  }, 300_000);
});
