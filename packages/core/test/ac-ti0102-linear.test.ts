import { describe, expect, it } from "vitest";
import type { TestIndex } from "../src/testIndex/types.js";
import { measureGrowth, threadCpuMs } from "./growth.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before the new TI02 rules exist, so nothing that
// depends on them may run while the file loads. The inputs are generated here, never written to fixtures/. One test
// file removes thousands of tests and adds thousands of `.each` tests in one describe that share the removed tests'
// subject (compute) but not their assertion chain (toBe at base, toBeGreaterThan at head), so the `.each` rule scans
// and never clears. Four other touched test files add many tests whose names share most words with the removed ones
// and whose bodies are unrelated, so the cross-file name probe finds candidates that fail containment. A small control
// file replaces three hand-written round() assertions by an it.each table: the new rules clear it, so a run where the
// new rules did not run cannot pass. Besides the timing, every run must report TI02 signals for the big file.
// The growth is measured on this thread's CPU time with measureGrowth (growth.ts) after a warm-up run of each size, and
// every run's CPU time stays under 15 s.

const REPO_ROOT = "/home/runner/work/demo/demo";
const BIG = "src/big.test.ts";
const CONTROL = "src/control.test.ts";
const OTHERS = [0, 1, 2, 3].map((k) => `src/other-${k}.test.ts`);
// The cap: one run at it holds the 15 s ceiling. The growth is measured at half of it (CORE-134, half the cost): a
// temporarily quadratic TI02 pass still fails the limit of 8 there.
const CAP = 524_288;
const FULL = CAP / 2;
const QUARTER = FULL / 4;
const CEILING_MS = 15_000;
const IMPORTS = 'import { describe, expect, it } from "vitest";\n\n';

const removed = (i: number) =>
  `  it("removes case ${i}", () => {\n    const value${i} = load(${i});\n    expect(compute(value${i})).toBe(${i});\n  });\n`;
const eachTest = (j: number) =>
  `  it.each([[${j}], [${j + 1}]])("adds case ${j} %s", (x) => {\n    expect(compute(x)).toBeGreaterThan(${j});\n  });\n`;
const elsewhere = (i: number) =>
  `  it("removes case ${i} again", () => {\n    const s${i} = "${i}";\n    expect(s${i}.length).toBeGreaterThan(0);\n  });\n`;

/** A describe of the tests `make(0..)` gives, the whole file at most `bytes` long; returns the text and the count. */
function fill(
  side: string,
  group: string,
  make: (n: number) => string,
  bytes: number,
): { text: string; count: number } {
  let text = `// ${side}\n${IMPORTS}describe("${group}", () => {\n`;
  const close = "});\n";
  let count = 0;
  for (;;) {
    const next = make(count);
    if (text.length + next.length + close.length > bytes) break;
    text += next;
    count++;
  }
  return { text: text + close, count };
}

const KEEPS = '  it("keeps", () => {\n    expect(1).toBe(1);\n  });\n';

function generate(bytes: number) {
  const base = fill("base", "big", removed, bytes);
  const head = fill("head", "big", eachTest, bytes);
  const files: Array<{ path: string; base: string; head: string }> = [{ path: BIG, base: base.text, head: head.text }];
  OTHERS.forEach((path, k) => {
    let added = "";
    for (let i = k; i < base.count; i += OTHERS.length) added += elsewhere(i);
    files.push({
      path,
      base: `// base\n${IMPORTS}describe("other ${k}", () => {\n${KEEPS}});\n`,
      head: `// head\n${IMPORTS}describe("other ${k}", () => {\n${KEEPS}${added}});\n`,
    });
  });
  files.push({
    path: CONTROL,
    base: `// base\n${IMPORTS}describe("round", () => {\n  it("rounds 1.5", () => {\n    expect(round(1.5)).toBe(2);\n    expect(round(2.5)).toBe(3);\n    expect(round(0.4)).toBe(0);\n  });\n});\n`,
    head: `// head\n${IMPORTS}describe("round", () => {\n  it.each([[1.5, 2], [2.5, 3], [0.4, 0]])("rounds %s", (x, y) => {\n    expect(round(x)).toBe(y);\n  });\n});\n`,
  });
  const diff = files
    .map((f) =>
      [
        `diff --git a/${f.path} b/${f.path}`,
        "index 1111111..2222222 100644",
        `--- a/${f.path}`,
        `+++ b/${f.path}`,
        "@@ -1 +1 @@",
        "-// base",
        "+// head",
        "",
      ].join("\n"),
    )
    .join("");
  return {
    data: {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...files.map((f) => f.path), "src/compute.ts"].sort(),
      testSources: {
        base: { files: files.map((f) => ({ path: f.path, text: f.base })), dropped: [] },
        head: { files: files.map((f) => ({ path: f.path, text: f.head })), dropped: [] },
      },
      testIntegrityMode: { input: "block" as const },
    },
    sizes: { base: base.text.length, head: head.text.length, removed: base.count, added: head.count },
    files,
  };
}

describe("TI02 precision: the new rules stay linear", () => {
  it("AC-13: a test file removing thousands of tests and adding thousands of .each tests, with other touched files of similarly named tests, gives TI02 signals and finishes within 15 s at the 512 KiB cap, and at 256 KiB takes less than 8 times the median of the 64 KiB input, each run within 15 s", async () => {
    const { check } = await import("./text-coverage.js");
    const cap = generate(CAP);
    const full = generate(FULL);
    const quarter = generate(QUARTER);
    const least: Record<number, number> = { [CAP]: 3000, [FULL]: 1500, [QUARTER]: 350 };
    for (const [run, bytes] of [
      [cap, CAP],
      [full, FULL],
      [quarter, QUARTER],
    ] as const) {
      expect(run.sizes.base).toBeLessThanOrEqual(bytes);
      expect(run.sizes.head).toBeLessThanOrEqual(bytes);
      expect(run.sizes.base, "the base file fills the size").toBeGreaterThan(bytes - 200);
      expect(run.sizes.removed, "it removes thousands of tests").toBeGreaterThan(least[bytes] as number);
      expect(run.sizes.added, "and adds thousands of .each tests").toBeGreaterThan(least[bytes] as number);
    }
    // The generated files are valid TypeScript: the existing test index parses them with no syntax error.
    const core = await import("../src/testIndex/indexTestFile.js");
    for (const run of [full, quarter]) {
      for (const f of run.files) {
        for (const text of [f.base, f.head]) {
          const result = core.indexTestFile(f.path, text);
          expect(result.parsed, `${f.path}: ${JSON.stringify(result)}`).toBe(true);
          expect((result as TestIndex).syntaxErrors).toBe(0);
        }
      }
    }

    const all: number[] = [];
    const time = (run: ReturnType<typeof generate>) => {
      const started = threadCpuMs();
      const report = check(run.data);
      const ms = threadCpuMs() - started;
      all.push(ms);
      const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
      expect(
        ti02.some((s) => s.path === BIG),
        "the run compared the big file and reports TI02",
      ).toBe(true);
      expect(
        ti02.filter((s) => s.path === CONTROL),
        "control: the new rules ran (the .each replacement is cleared)",
      ).toEqual([]);
      return { ms, report };
    };

    // The cap run: TI02 signals and the 15 s ceiling (every timed run's CPU time is checked against it at the end).
    expectValidReport(time(cap).report);
    for (const run of [full, quarter]) {
      const warm = time(run);
      expectValidReport(warm.report);
      expect(warm.report.testIntegrity.languages, "the files were indexed").toEqual(["ts"]);
    }
    const growth = await measureGrowth(
      () => time(quarter),
      () => time(full),
    );
    expect(growth.ratio, `full vs quarter: ${growth.detail}`).toBeLessThan(8);
    for (const ms of all) expect(ms, "every run finishes within 15 s of CPU time").toBeLessThan(CEILING_MS);
  }, 300_000);
});
