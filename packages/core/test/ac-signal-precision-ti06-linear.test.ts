import { describe, expect, it } from "vitest";
import { measureGrowth } from "./growth.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI06 reads the expect subject, so nothing the
// build adds may run while the file loads. The test files are generated here: one test whose body is full of what a
// reader of test text can stall on (unclosed brackets and lone quote characters in comments and string literals, which
// a literal-unaware or comment-unaware scan reads as unterminated, and many `expect(` calls), ending with an
// `expect(typeof …).toBe('function')` chain whose subject is longer than 200 code units, rewritten at head to
// `toBeTypeOf('function')`. The files are valid TypeScript, so the test index parses them. The host is loaded, so the
// timing compares this thread's CPU time over samples of many runs (measureGrowth, growth.ts), never an absolute
// budget.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/big.test.ts";
const SMALL = 100_000;
const LARGE = 4 * SMALL;
const KEY = "k".repeat(220);
const SUBJECT = `registry.lookup("${KEY}").handler`;
const BASE_CHAIN = `  expect(typeof ${SUBJECT}).toBe('function');`;
const HEAD_CHAIN = `  expect(${SUBJECT}).toBeTypeOf('function');`;

/** Filler line `n` of the long test body. */
const filler = (n: number) =>
  [
    `  // it's (((  [[[ {{{ expect( "open ${n}`,
    `  const s${n} = "((( [[[ {{{ expect( ' \` ";`,
    `  const v${n} = [${n}, "a'b", 'c"d', \`e'f"\`];`,
    `  expect(v${n}.length).toBeGreaterThan(${n % 3});`,
  ].join("\n");

/** A test file of one test whose body is at least `bodyChars` long and ends with `chain`. */
function testFile(bodyChars: number, chain: string): string {
  const lines: string[] = [];
  let size = 0;
  for (let n = 0; size < bodyChars; n++) {
    const line = filler(n);
    lines.push(line);
    size += line.length + 1;
  }
  return [
    'import { expect, it } from "vitest";',
    'import { registry } from "./registry.js";',
    "",
    'it("looks up every handler", () => {',
    ...lines,
    chain,
    "});",
    "",
  ].join("\n");
}

function input(bodyChars: number) {
  const base = testFile(bodyChars, BASE_CHAIN);
  const head = testFile(bodyChars, HEAD_CHAIN);
  const at = base.split("\n").indexOf(BASE_CHAIN) + 1;
  const diff = [
    `diff --git a/${PATH} b/${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${PATH}`,
    `+++ b/${PATH}`,
    `@@ -${at} +${at} @@`,
    `-${BASE_CHAIN}`,
    `+${HEAD_CHAIN}`,
    "",
  ].join("\n");
  return {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [PATH, "src/registry.ts"],
    testSources: {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
    testIntegrityMode: { input: "block" },
  };
}

describe("TI06: the expect-subject reader is linear", () => {
  it("AC-12: a 100,000-character test body full of unclosed brackets, unterminated quotes and expect( calls, ending in a typeof chain with a subject over 200 code units rewritten to toBeTypeOf, gives no TI06, nor does the same body four times as long, which takes less than eight times as long", async () => {
    const { check } = await import("../src/check.js");
    type Input = Parameters<typeof check>[0];
    expect(SUBJECT.length).toBeGreaterThan(200);

    // The long subject alone, in a short body, is read through its bounded head: the rewrite is equivalent.
    const short = input(0);
    const shortReport = check(short as unknown as Input);
    expectValidReport(shortReport);
    expect(
      shortReport.testIntegrity.signals.filter((s) => String(s.id) === "TI06"),
      "the long subject in a short body",
    ).toEqual([]);

    const small = input(SMALL);
    const large = input(LARGE);
    // The generated files are valid TypeScript: the existing test index parses them with no syntax error.
    const core = (await import("@pharn-ci/core")) as unknown as {
      indexTestFile(path: string, text: string): { parsed: boolean; syntaxErrors?: number };
    };
    for (const run of [short, small, large]) {
      for (const side of [run.testSources.base, run.testSources.head]) {
        const result = core.indexTestFile(PATH, (side.files[0] as { text: string }).text);
        expect(result.parsed, JSON.stringify(result)).toBe(true);
        expect(result.syntaxErrors).toBe(0);
      }
    }

    for (const [label, run] of [
      ["100,000 characters", small],
      ["400,000 characters", large],
    ] as const) {
      const report = check(run as unknown as Input);
      expectValidReport(report);
      expect(report.testIntegrity.languages, `${label}: the file was indexed`).toEqual(["ts"]);
      expect(
        report.testIntegrity.signals.filter((s) => String(s.id) === "TI06"),
        `${label}: no TI06`,
      ).toEqual([]);
    }

    const smallInput = small as unknown as Input;
    const largeInput = large as unknown as Input;
    const growth = await measureGrowth(
      () => check(smallInput),
      () => check(largeInput),
    );
    expect(growth.ratio, `400,000 vs 100,000 characters: ${growth.detail}`).toBeLessThan(8);
  }, 300_000);
});
