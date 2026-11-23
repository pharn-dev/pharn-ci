import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestBlock } from "../src/testIndex/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-145 part A, AC-2. check(), the test index and the body-token helpers are loaded inside the test body: the AC test
// is written before the pairing is rebuilt as one bounded loop, so nothing the build changes may run while this file
// loads. The inputs are generated here, never written to fixtures/.
//
// One modified test file: its one base test is renamed at head and its body edited (one statement added), so the body
// hash and the leaf name differ while the body-token Jaccard stays at least 4/5. Ahead of it, the head file adds N
// unrelated new tests whose bodies share no word token with it (only punctuation). Phase 1 compares the removed test with at most 256
// not-yet-paired new tests of the file, in head order: with 255 unrelated tests the renamed test is the 256th and is
// paired; with 256 it is the 257th, the search stops at the bound, and the removed test is reported as an ordinary TI02
// at its base line, at the mode's severity.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const IMPORTS = 'import { assert, expect, it } from "vitest";\nimport { createCart } from "./cart.js";\n\n';
const OLD_NAME = "adds up the cart total";
const NEW_NAME = "sums the basket";

const body = (extra: string) =>
  `  const cart = createCart();\n  cart.add({ sku: "apple", price: 2, quantity: 3 });\n  cart.add({ sku: "pear", price: 5, quantity: 1 });\n${extra}  expect(cart.total()).toBe(11);\n`;
const OLD = `it("${OLD_NAME}", () => {\n${body("")}});\n`;
const NEW = `it("${NEW_NAME}", () => {\n${body("  cart.freeze();\n")}});\n`;
const unrelated = (i: number) => `it("checks widget ${i}", () => {\n  assert.ok(widget${i});\n});\n`;

function generate(count: number) {
  const base = `// base\n${IMPORTS}${OLD}`;
  let head = `// head\n${IMPORTS}`;
  for (let i = 0; i < count; i++) head += unrelated(i);
  head += NEW;
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
  return { base, head, diff };
}

async function testsOf(text: string): Promise<TestBlock[]> {
  const { indexTestFile } = await import("../src/testIndex/indexTestFile.js");
  const result = indexTestFile(PATH, text);
  if (!result.parsed) throw new Error(`the generated text does not parse: ${JSON.stringify(result)}`);
  expect(result.syntaxErrors, "the generated text has no syntax error").toBe(0);
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
    repoFiles: [PATH, "src/cart.ts"],
    testSources: {
      base: { files: [{ path: PATH, text: gen.base }], dropped: [] },
      head: { files: [{ path: PATH, text: gen.head }], dropped: [] },
    },
    testIntegrityMode: { input: mode },
  });
  expectValidReport(report);
  expect(report.testIntegrity.languages, "the file was compared").toEqual(["ts"]);
  return report;
}

const ti02 = (report: Report) =>
  report.testIntegrity.signals.filter((s) => s.id === "TI02").map((s) => [s.path, s.line, s.severity]);

describe("phase 1: a renamed test with an edited body is compared with at most 256 new tests of its file", () => {
  it("AC-2: with 255 unrelated new tests ahead of the renamed test there is no TI02; with 256 there is exactly one TI02 for it at its base line, block in mode block and warn in mode warn", async () => {
    const tokens = await import("../src/signals/bodyTokens.js");
    const [was] = await testsOf(generate(256).base);
    if (was === undefined) throw new Error("the base side has no test");
    expect(was.path, "the base test").toEqual([OLD_NAME]);
    for (const count of [255, 256]) {
      const head = await testsOf(generate(count).head);
      expect(head.length, "the unrelated new tests, then the renamed one").toBe(count + 1);
      const now = head[count] as TestBlock;
      expect(now.path, "the renamed test is last, behind the unrelated ones").toEqual([NEW_NAME]);
      expect(now.bodyHash, "the body was edited").not.toBe(was.bodyHash);
      expect(
        tokens.jaccardAtLeast(tokens.bodyTokenSet(was.body), tokens.bodyTokenSet(now.body), tokens.FOUR_FIFTHS),
        "the body-token Jaccard is at least 4/5",
      ).toBe(true);
      const oldTokens = tokens.bodyTokenSet(was.body);
      for (const other of head.slice(0, count)) {
        const shared = [...tokens.bodyTokenSet(other.body)].filter((t) => /\w/.test(t) && oldTokens.has(t));
        expect(shared, `the unrelated test ${other.name} shares no word token with the removed one`).toEqual([]);
      }
    }

    for (const mode of ["block", "warn"] as const) {
      expect(
        ti02(await run(255, mode)),
        `mode ${mode}, 255 unrelated new tests ahead: the renamed test is paired`,
      ).toEqual([]);
    }
    for (const mode of ["block", "warn"] as const) {
      expect(
        ti02(await run(256, mode)),
        `mode ${mode}, 256 unrelated new tests ahead: the match lies past the bound, so the test is reported`,
      ).toEqual([[PATH, was.line, mode]]);
    }
  }, 120_000);
});
