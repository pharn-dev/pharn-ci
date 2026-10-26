import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI02's phase-2 leaf pick asks for body
// evidence, so nothing that depends on it may run while the file loads. The hostile input is generated here, never
// written to fixtures/: src/a.test.ts removes thousands of tests that all share the leaf name `works` (each in its own
// describe, each with a real assertion), and src/b.test.ts gains thousands of hollow `works` tests
// (`expect(true).toBe(true)`), more than were removed. A leaf name alone cleared every one of them before this change, so
// a run with no TI02 for src/a.test.ts is the name-only pick. Each run must report TI02 blocks for src/a.test.ts within
// the per-file finding cap, and the full-size run must take less than 8 times the quarter-size run (medians of three,
// after a warm-up run of each).

const REPO_ROOT = "/home/runner/work/demo/demo";
const A = "src/a.test.ts";
const B = "src/b.test.ts";
const FULL = 524_288;
const QUARTER = FULL / 4;
const CEILING_MS = 15_000;
const IMPORTS = 'import { describe, expect, it } from "vitest";\n\n';
const KEEPS = 'describe("kept", () => {\n  it("keeps", () => {\n    expect(1).toBe(1);\n  });\n});\n';

const removed = (i: number) =>
  `describe("case ${i}", () => {\n  it("works", () => {\n    const value = load(${i});\n    expect(compute(value, "c${i}")).toEqual({ total: ${i} });\n  });\n});\n`;
const hollow = (j: number) =>
  `describe("moved ${j}", () => {\n  it("works", () => {\n    expect(true).toBe(true);\n  });\n});\n`;

/** `make(0..)` appended after the imports and the kept test, the whole file at most `bytes` long. */
function fill(side: string, make: (n: number) => string, bytes: number): { text: string; count: number } {
  let text = `// ${side}\n${IMPORTS}${KEEPS}`;
  let count = 0;
  for (;;) {
    const next = make(count);
    if (text.length + next.length > bytes) break;
    text += next;
    count++;
  }
  return { text, count };
}

function generate(bytes: number) {
  const aBase = fill("base", removed, bytes);
  const bHead = fill("head", hollow, bytes);
  const files = [
    { path: A, base: aBase.text, head: `// head\n${IMPORTS}${KEEPS}` },
    { path: B, base: `// base\n${IMPORTS}${KEEPS}`, head: bHead.text },
  ];
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
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...files.map((f) => f.path), "src/compute.ts"].sort(),
      testSources: {
        base: { files: files.map((f) => ({ path: f.path, text: f.base })), dropped: [] },
        head: { files: files.map((f) => ({ path: f.path, text: f.head })), dropped: [] },
      },
      testIntegrityMode: { input: "block" },
    },
    sizes: { removed: aBase.count, hollow: bHead.count, base: aBase.text.length, head: bHead.text.length },
    files,
  };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

describe("TI02 phase 2: the body-checked leaf pick stays linear", () => {
  it("AC-8: thousands of removed `works` tests beside thousands of hollow `works` tests in another touched file give TI02 blocks within the finding cap at full and quarter size, and the full run takes less than 8 times the quarter run", async () => {
    const { check } = await import("../src/check.js");
    const { MAX_FINDINGS_PER_FILE } = (await import("../src/signals/findingCap.js")) as unknown as {
      MAX_FINDINGS_PER_FILE: number;
    };
    type Input = Parameters<typeof check>[0];
    const full = generate(FULL);
    const quarter = generate(QUARTER);
    for (const [run, bytes] of [
      [full, FULL],
      [quarter, QUARTER],
    ] as const) {
      expect(run.sizes.base).toBeLessThanOrEqual(bytes);
      expect(run.sizes.head).toBeLessThanOrEqual(bytes);
      expect(run.sizes.removed, "thousands of removed `works` tests").toBeGreaterThan(bytes === FULL ? 3000 : 700);
      expect(run.sizes.hollow, "more hollow `works` tests than removed ones").toBeGreaterThan(run.sizes.removed);
    }
    // The generated files are valid TypeScript: the existing test index parses them with no syntax error.
    const core = (await import("@pharn-ci/core")) as unknown as {
      indexTestFile(path: string, text: string): { parsed: boolean; syntaxErrors?: number };
    };
    for (const run of [full, quarter]) {
      for (const f of run.files) {
        for (const text of [f.base, f.head]) {
          const result = core.indexTestFile(f.path, text);
          expect(result.parsed, `${f.path}: ${JSON.stringify(result).slice(0, 200)}`).toBe(true);
          expect(result.syntaxErrors).toBe(0);
        }
      }
    }

    const all: number[] = [];
    const time = (run: ReturnType<typeof generate>) => {
      const started = performance.now();
      const report = check(run.data as unknown as Input) as unknown as {
        testIntegrity: { signals: { id: string; severity: string; path: string }[]; languages: string[] };
      };
      const ms = performance.now() - started;
      all.push(ms);
      const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
      const mine = ti02.filter((s) => s.path === A);
      expect(
        mine.length,
        "TI02 blocks for the removed `works` tests: a leaf name alone does not clear them",
      ).toBeGreaterThan(0);
      expect(mine.length, "within the per-file finding cap").toBeLessThanOrEqual(MAX_FINDINGS_PER_FILE);
      expect(
        mine.every((s) => s.severity === "block"),
        "every one a block",
      ).toBe(true);
      return { ms, report };
    };

    for (const run of [full, quarter]) {
      const warm = time(run);
      expectValidReport(warm.report);
      expect(warm.report.testIntegrity.languages, "the files were indexed").toEqual(["ts"]);
    }
    const fullRuns = [time(full).ms, time(full).ms, time(full).ms];
    const quarterRuns = [time(quarter).ms, time(quarter).ms, time(quarter).ms];

    expect(median(fullRuns), `full ${fullRuns.join(", ")} ms vs quarter ${quarterRuns.join(", ")} ms`).toBeLessThan(
      8 * median(quarterRuns),
    );
    for (const ms of all) expect(ms, "every run finishes within 15 s").toBeLessThan(CEILING_MS);
  }, 300_000);
});
