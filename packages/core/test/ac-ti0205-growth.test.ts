import { describe, expect, it } from "vitest";
import { measureGrowth, threadCpuMs } from "./growth.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before check() compares test files, so nothing that
// depends on that may run while the file loads. The texts are generated here: every base test is removed and as many
// new tests with dissimilar bodies are added, each body with its own identifiers. Besides the timing, the test checks
// that the comparison ran (TI02 findings and languages ["ts"]), so a check that skips the files cannot pass it.
// The growth is measured on this thread's CPU time with measureGrowth (growth.ts) after a warm-up run of each size,
// and every run's CPU time is held under the 15 s ceiling.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/big.test.ts";
const FULL = 524_288;
const QUARTER = FULL / 4;
const CEILING_MS = 15_000;
const HEADER = 'import { expect, it } from "vitest";\n\n';

/**
 * A base and a head test file with the same number of tests, the larger of the two at most `bytes` bytes (ASCII): every
 * base test is gone at head, and every head test has another name and a dissimilar body.
 */
function generate(bytes: number): { base: { text: string; count: number }; head: { text: string; count: number } } {
  let base = HEADER;
  let head = HEADER;
  let count = 0;
  for (;;) {
    const b = `it("base case ${count}", () => {\n  const baseV${count} = baseF${count}(${count});\n  expect(baseV${count}).toBe(${count});\n});\n`;
    const h = `it("head case ${count}", async () => {\n  const headQ${count} = await headLoad${count}("${count}");\n  expect(headQ${count}).toEqual([${count}, "${count}"]);\n});\n`;
    if (base.length + b.length > bytes || head.length + h.length > bytes) break;
    base += b;
    head += h;
    count++;
  }
  return { base: { text: base, count }, head: { text: head, count } };
}

function input(bytes: number) {
  const { base, head } = generate(bytes);
  const baseLine = base.text.split("\n")[2] ?? "";
  const headLine = head.text.split("\n")[2] ?? "";
  const diff = [
    `diff --git a/${PATH} b/${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${PATH}`,
    `+++ b/${PATH}`,
    "@@ -3 +3 @@",
    `-${baseLine}`,
    `+${headLine}`,
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
        base: { files: [{ path: PATH, text: base.text }], dropped: [] },
        head: { files: [{ path: PATH, text: head.text }], dropped: [] },
      },
      testIntegrityMode: { input: "block" },
    },
    sizes: { base: base.text.length, head: head.text.length, tests: base.count, headTests: head.count },
  };
}

describe("TI02 and TI05: the comparison of one file grows less than eightfold from a quarter of the cap", () => {
  it("AC-18: 512 KiB base and head files take less than 8 times the median of 128 KiB ones, each run within 15 s", async () => {
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
      expect(Math.max(run.sizes.base, run.sizes.head), "the larger file fills the size").toBeGreaterThan(bytes - 200);
      expect(run.sizes.headTests).toBe(run.sizes.tests);
    }

    const all: number[] = [];
    const time = (run: ReturnType<typeof input>) => {
      const started = threadCpuMs();
      const report = check(run.data as unknown as Input) as unknown as {
        testIntegrity: { signals: { id: string }[]; languages: string[] };
      };
      const ms = threadCpuMs() - started;
      all.push(ms);
      return { ms, report };
    };

    for (const run of [full, quarter]) {
      const warm = time(run);
      expectValidReport(warm.report);
      // The comparison ran: the removed base tests are TI02 findings and the file was indexed.
      expect(warm.report.testIntegrity.signals.filter((s) => String(s.id) === "TI02").length).toBeGreaterThan(0);
      expect(warm.report.testIntegrity.languages).toEqual(["ts"]);
    }
    const growth = await measureGrowth(
      () => time(quarter),
      () => time(full),
    );
    expect(growth.ratio, `full vs quarter: ${growth.detail}`).toBeLessThan(8);
    for (const ms of all) expect(ms, "every run finishes within 15 s of CPU time").toBeLessThan(CEILING_MS);
  }, 300_000);
});
