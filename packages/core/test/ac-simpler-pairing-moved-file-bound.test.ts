import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestBlock } from "../src/testIndex/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-145 part A, AC-4. check(), the test index and the body-token helpers are loaded inside the test body: the AC test
// is written before the moved-test-file matching is folded into matchTests, so nothing the build changes may run while
// this file loads. The inputs are generated here, never written to fixtures/.
//
// A deleted test file (src/cart.test.ts) with one test, and an added test file of the same stem (src/cart.spec.ts)
// whose new tests with an assertion are N unrelated tests (bodies sharing no word token with the deleted test), then
// that test renamed with its body edited (one statement added: a different body hash, a body-token Jaccard of at least
// 4/5, a different leaf name). The code the deleted file tested (src/cart.ts) stays. The moved-file body probe compares
// the deleted test with at most 256 not-yet-paired new tests with an assertion, in head order: with 255 unrelated tests
// the renamed one is the 256th, every test of the deleted file is found again, and TI01 is `info`; with 256 it is the
// 257th, past the bound, so the file does not count as moved and TI01 stays at the mode's level, `block`.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DELETED = "src/cart.test.ts";
const ADDED = "src/cart.spec.ts";
const IMPORTS = 'import { assert, expect, it } from "vitest";\nimport { createCart } from "./cart.js";\n\n';
const OLD_NAME = "adds up the cart total";
const NEW_NAME = "sums the basket";

const body = (extra: string) =>
  `  const cart = createCart();\n  cart.add({ sku: "apple", price: 2, quantity: 3 });\n  cart.add({ sku: "pear", price: 5, quantity: 1 });\n${extra}  expect(cart.total()).toBe(11);\n`;
const OLD = `it("${OLD_NAME}", () => {\n${body("")}});\n`;
const NEW = `it("${NEW_NAME}", () => {\n${body("  cart.freeze();\n")}});\n`;
const unrelated = (i: number) => `it("checks widget ${i}", () => {\n  assert.ok(widget${i});\n});\n`;

const linesOf = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

function generate(count: number) {
  const deleted = `${IMPORTS}${OLD}`;
  let added = IMPORTS;
  for (let i = 0; i < count; i++) added += unrelated(i);
  added += NEW;
  const removedLines = linesOf(deleted);
  const addedLines = linesOf(added);
  const diff = [
    `diff --git a/${DELETED} b/${DELETED}`,
    "deleted file mode 100644",
    "index 5555555..0000000",
    `--- a/${DELETED}`,
    "+++ /dev/null",
    `@@ -1,${removedLines.length} +0,0 @@`,
    ...removedLines.map((line) => `-${line}`),
    `diff --git a/${ADDED} b/${ADDED}`,
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    `+++ b/${ADDED}`,
    `@@ -0,0 +1,${addedLines.length} @@`,
    ...addedLines.map((line) => `+${line}`),
    "",
  ].join("\n");
  return { deleted, added, diff };
}

async function testsOf(path: string, text: string): Promise<TestBlock[]> {
  const { indexTestFile } = await import("../src/testIndex/indexTestFile.js");
  const result = indexTestFile(path, text);
  if (!result.parsed) throw new Error(`the generated text of ${path} does not parse: ${JSON.stringify(result)}`);
  expect(result.syntaxErrors, `the generated text of ${path} has no syntax error`).toBe(0);
  return result.tests.filter((b) => b.kind === "test");
}

async function run(count: number): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const gen = generate(count);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: gen.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [ADDED, "src/cart.ts"],
    testSources: {
      base: { files: [{ path: DELETED, text: gen.deleted }], dropped: [] },
      head: { files: [{ path: ADDED, text: gen.added }], dropped: [] },
    },
    testIntegrityMode: { input: "block" },
  });
  expectValidReport(report);
  return report;
}

const ti01 = (report: Report) =>
  report.testIntegrity.signals.filter((s) => s.id === "TI01").map((s) => [s.path, s.severity]);

describe("the moved-file body probe compares a deleted test with at most 256 new tests with an assertion", () => {
  it("AC-4: a deleted one-test file whose test is found renamed and edited in an added same-stem file behind 255 unrelated tests with an assertion gives TI01 info; behind 256 it gives TI01 block", async () => {
    const tokens = await import("../src/signals/bodyTokens.js");
    const deleted = await testsOf(DELETED, generate(256).deleted);
    expect(
      deleted.map((b) => b.path),
      "the deleted file holds one test",
    ).toEqual([[OLD_NAME]]);
    const was = deleted[0] as TestBlock;
    const oldTokens = tokens.bodyTokenSet(was.body);
    for (const count of [255, 256]) {
      const head = await testsOf(ADDED, generate(count).added);
      expect(head.length, "the unrelated new tests, then the renamed one").toBe(count + 1);
      for (const block of head) expect(block.assertionCount, `${block.name} has an assertion`).toBeGreaterThan(0);
      const now = head[count] as TestBlock;
      expect(now.path, "the renamed test is last, behind the unrelated ones").toEqual([NEW_NAME]);
      expect(now.bodyHash, "the body was edited").not.toBe(was.bodyHash);
      expect(
        tokens.jaccardAtLeast(oldTokens, tokens.bodyTokenSet(now.body), tokens.FOUR_FIFTHS),
        "the body-token Jaccard is at least 4/5",
      ).toBe(true);
      for (const other of head.slice(0, count)) {
        const shared = [...tokens.bodyTokenSet(other.body)].filter((t) => /\w/.test(t) && oldTokens.has(t));
        expect(shared, `the unrelated test ${other.name} shares no word token with the deleted one`).toEqual([]);
      }
    }

    expect(ti01(await run(255)), "255 unrelated tests ahead: the deleted file's test is found again").toEqual([
      [DELETED, "info"],
    ]);
    expect(
      ti01(await run(256)),
      "256 unrelated tests ahead: the match lies past the bound, so TI01 stays at the mode's level",
    ).toEqual([[DELETED, "block"]]);
  }, 120_000);
});
