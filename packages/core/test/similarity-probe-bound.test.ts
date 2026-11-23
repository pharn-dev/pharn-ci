import { describe, expect, it } from "vitest";
import { MAX_SIMILARITY_PROBES } from "../src/signals/bodyTokens.js";
import { matchTests } from "../src/signals/testMatch.js";
import { indexTestFile } from "../src/testIndex/indexTestFile.js";
import type { TestBlock } from "../src/testIndex/types.js";

// matchTests compares a removed test with at most MAX_SIMILARITY_PROBES not-yet-paired new tests per rule, in head order
// (testMatch.ts, FreeList). The linear-time tests of TI01/TI02 (ac-ti0102-linear) never reach the bound, so they pass
// with it removed (CORE-134). Here one modified test file loses its one test, which comes back renamed and with one
// statement added (a different hash and leaf name, a body-token Jaccard of at least 4/5), behind N unrelated new tests
// that share no word token with it. Rewritten for CORE-145 through the public path: the prefix index this test used to
// call is gone.

const PATH = "src/cart.test.ts";
const IMPORTS = 'import { assert, expect, it } from "vitest";\nimport { createCart } from "./cart.js";\n\n';
const OLD_NAME = "adds up the cart total";
const NEW_NAME = "sums the basket";

const body = (extra: string) =>
  `  const cart = createCart();\n  cart.add({ sku: "apple", price: 2, quantity: 3 });\n  cart.add({ sku: "pear", price: 5, quantity: 1 });\n${extra}  expect(cart.total()).toBe(11);\n`;
const OLD = `it("${OLD_NAME}", () => {\n${body("")}});\n`;
const NEW = `it("${NEW_NAME}", () => {\n${body("  cart.freeze();\n")}});\n`;
const unrelated = (i: number) => `it("checks widget ${i}", () => {\n  assert.ok(widget${i});\n});\n`;

function testsOf(text: string): TestBlock[] {
  const result = indexTestFile(PATH, text);
  if (!result.parsed) throw new Error(`the generated text does not parse: ${JSON.stringify(result)}`);
  return result.tests.filter((block) => block.kind === "test");
}

/** The tests matchTests reports as removed, by name, for one file whose base and head text are given. */
function unmatchedNames(baseText: string, headText: string): string[] {
  const match = matchTests({
    pairs: [
      {
        basePath: PATH,
        headPath: PATH,
        base: testsOf(`${IMPORTS}${baseText}`),
        head: testsOf(`${IMPORTS}${headText}`),
        baseMocks: [],
        headMocks: [],
      },
    ],
    added: [],
  });
  return match.unmatched.map((candidate) => candidate.block.name);
}

const widgets = (count: number) => Array.from({ length: count }, (_, i) => unrelated(i)).join("");

describe("matchTests: the probe bound", () => {
  it("the bound is 256 not-yet-paired new tests per rule", () => {
    // Raising it raises the cost of every rule in TI01 and TI02 matching; that is a decision, made here.
    expect(MAX_SIMILARITY_PROBES).toBe(256);
  });

  it("a removed test whose only similar new test is the 257th free one of its file is reported; at the 256th it is paired", () => {
    expect(unmatchedNames(OLD, `${widgets(MAX_SIMILARITY_PROBES - 1)}${NEW}`), "the match is the 256th").toEqual([]);
    expect(unmatchedNames(OLD, `${widgets(MAX_SIMILARITY_PROBES)}${NEW}`), "the match is the 257th").toEqual([
      OLD_NAME,
    ]);
  });

  it("new tests already paired do not count: 256 of them ahead of the match do not hide it", () => {
    // Each of the 256 base tests keeps its body and loses its name, so phase 1 pairs it with the new test of that body.
    const paired = (i: number, name: string) => `it("${name} ${i}", () => {\n  assert.ok(gadget${i});\n});\n`;
    const count = MAX_SIMILARITY_PROBES;
    const before = Array.from({ length: count }, (_, i) => paired(i, "was")).join("");
    const after = Array.from({ length: count }, (_, i) => paired(i, "now")).join("");
    expect(unmatchedNames(`${before}${OLD}`, `${after}${NEW}`), "the removed test is found behind them").toEqual([]);
  });

  it("control: the bound is a position, not a size: the removed test is the first of many new tests and is paired", () => {
    expect(unmatchedNames(OLD, `${NEW}${widgets(4 * MAX_SIMILARITY_PROBES)}`)).toEqual([]);
  });
});
