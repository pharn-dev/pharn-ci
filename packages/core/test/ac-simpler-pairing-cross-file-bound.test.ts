import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestBlock } from "../src/testIndex/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-145 part A, AC-3. check(), the test index and the body-token helpers are loaded inside the test body: the AC test
// is written before the pairing is rebuilt as one bounded loop, so nothing the build changes may run while this file
// loads. The inputs are generated here, never written to fixtures/.
//
// A modified test file (src/cart.test.ts) loses one of its two tests. An added test file (src/checkout.test.ts) holds
// that test renamed, its body edited (one statement added: a different body hash, a body-token Jaccard of at least
// 4/5, a different leaf name), behind N unrelated new tests whose bodies share no word token with it. The cross-file
// body rule compares the removed test with at most 256 not-yet-paired new tests of the other files, in head order: with
// 255 unrelated tests the renamed one is the 256th and is paired; with 256 it is the 257th, past the bound, and the
// removed test is reported as an ordinary TI02 at its base line, at the mode's severity.

const REPO_ROOT = "/home/runner/work/demo/demo";
const SOURCE = "src/cart.test.ts";
const TARGET = "src/checkout.test.ts";
const IMPORTS = 'import { assert, expect, it } from "vitest";\nimport { createCart } from "./cart.js";\n\n';
const OLD_NAME = "adds up the cart total";
const NEW_NAME = "sums the basket";
const KEEP = 'it("starts empty", () => {\n  expect(createCart().total()).toBe(0);\n});\n';

const body = (extra: string) =>
  `  const cart = createCart();\n  cart.add({ sku: "apple", price: 2, quantity: 3 });\n  cart.add({ sku: "pear", price: 5, quantity: 1 });\n${extra}  expect(cart.total()).toBe(11);\n`;
const OLD = `it("${OLD_NAME}", () => {\n${body("")}});\n`;
const NEW = `it("${NEW_NAME}", () => {\n${body("  cart.freeze();\n")}});\n`;
const unrelated = (i: number) => `it("checks widget ${i}", () => {\n  assert.ok(widget${i});\n});\n`;

function generate(count: number) {
  const sourceBase = `// base\n${IMPORTS}${KEEP}\n${OLD}`;
  const sourceHead = `// head\n${IMPORTS}${KEEP}`;
  let target = IMPORTS;
  for (let i = 0; i < count; i++) target += unrelated(i);
  target += NEW;
  const added = target.endsWith("\n") ? target.slice(0, -1).split("\n") : target.split("\n");
  const diff = [
    `diff --git a/${SOURCE} b/${SOURCE}`,
    "index 1111111..2222222 100644",
    `--- a/${SOURCE}`,
    `+++ b/${SOURCE}`,
    "@@ -1 +1 @@",
    "-// base",
    "+// head",
    `diff --git a/${TARGET} b/${TARGET}`,
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    `+++ b/${TARGET}`,
    `@@ -0,0 +1,${added.length} @@`,
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");
  return { sourceBase, sourceHead, target, diff };
}

async function testsOf(path: string, text: string): Promise<TestBlock[]> {
  const { indexTestFile } = await import("../src/testIndex/indexTestFile.js");
  const result = indexTestFile(path, text);
  if (!result.parsed) throw new Error(`the generated text of ${path} does not parse: ${JSON.stringify(result)}`);
  expect(result.syntaxErrors, `the generated text of ${path} has no syntax error`).toBe(0);
  return result.tests.filter((b) => b.kind === "test");
}

async function run(count: number, mode: "block" | "warn"): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const gen = generate(count);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: gen.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [SOURCE, "src/cart.ts", TARGET],
    testSources: {
      base: { files: [{ path: SOURCE, text: gen.sourceBase }], dropped: [] },
      head: {
        files: [
          { path: SOURCE, text: gen.sourceHead },
          { path: TARGET, text: gen.target },
        ],
        dropped: [],
      },
    },
    testIntegrityMode: { input: mode },
  });
  expectValidReport(report);
  expect(report.testIntegrity.languages, "the files were compared").toEqual(["ts"]);
  return report;
}

const ti02 = (report: Report) =>
  report.testIntegrity.signals.filter((s) => s.id === "TI02").map((s) => [s.path, s.line, s.severity]);

describe("the cross-file body rule compares a removed test with at most 256 new tests of the other files", () => {
  it("AC-3: a test removed from a modified file and found renamed and edited in an added file behind 255 unrelated new tests gives no TI02; behind 256 it gives exactly one TI02 at its base line, at the mode's severity", async () => {
    const tokens = await import("../src/signals/bodyTokens.js");
    const sourceBase = await testsOf(SOURCE, generate(256).sourceBase);
    expect(
      sourceBase.map((b) => b.path),
      "the source file's base tests",
    ).toEqual([["starts empty"], [OLD_NAME]]);
    const was = sourceBase[1] as TestBlock;
    expect(
      (await testsOf(SOURCE, generate(256).sourceHead)).map((b) => b.path),
      "at head the source file keeps only the other test",
    ).toEqual([["starts empty"]]);
    const oldTokens = tokens.bodyTokenSet(was.body);
    for (const count of [255, 256]) {
      const head = await testsOf(TARGET, generate(count).target);
      expect(head.length, "the unrelated new tests, then the renamed one").toBe(count + 1);
      const now = head[count] as TestBlock;
      expect(now.path, "the renamed test is last, behind the unrelated ones").toEqual([NEW_NAME]);
      expect(now.bodyHash, "the body was edited").not.toBe(was.bodyHash);
      expect(
        tokens.jaccardAtLeast(oldTokens, tokens.bodyTokenSet(now.body), tokens.FOUR_FIFTHS),
        "the body-token Jaccard is at least 4/5",
      ).toBe(true);
      for (const other of head.slice(0, count)) {
        const shared = [...tokens.bodyTokenSet(other.body)].filter((t) => /\w/.test(t) && oldTokens.has(t));
        expect(shared, `the unrelated test ${other.name} shares no word token with the removed one`).toEqual([]);
      }
    }

    for (const mode of ["block", "warn"] as const) {
      expect(
        ti02(await run(255, mode)),
        `mode ${mode}, 255 unrelated new tests ahead: the removed test is paired`,
      ).toEqual([]);
    }
    for (const mode of ["block", "warn"] as const) {
      expect(
        ti02(await run(256, mode)),
        `mode ${mode}, 256 unrelated new tests ahead: the match lies past the bound, so the test is reported`,
      ).toEqual([[SOURCE, was.line, mode]]);
    }
  }, 120_000);
});
