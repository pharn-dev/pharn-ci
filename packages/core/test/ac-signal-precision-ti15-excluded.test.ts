import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";

// check() is loaded inside the test body (through runDiff): the AC test is written before TI15 leaves out example,
// benchmark, docs and fixture directories and raises its minimums, and the fixtures it reads are written by the build,
// so nothing the build adds may run while the file loads.

/** The signal id and every string literal, built from parts so this file adds none of them as written. */
const ID = ["TI", "15"].join("");
const j = (...parts: string[]) => parts.join("");
const LITERAL = j("prem", "ium-tier");
const FIVE = j("kx", "qzv");
const SIX = j("kx", "qzvw");

/** A modified file that adds `lines` from line `at`. */
function addLines(path: string, at: number, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -${at - 1},0 +${at},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

/** A test file adding `expect(f(<lit>))` at line 8 and a source file comparing against it at line 12. */
const pair = (test: string, source: string, written: string) =>
  addLines(test, 8, [`  expect(f(${written})).toBe(1);`]) + addLines(source, 12, [`  if (s === ${written}) return 1;`]);

describe("TI15: excluded directories and the 6-unit and 4-digit minimums", () => {
  it("AC-8: a source under docs/, fixtures/ or bench/, a test under examples/, a 5-character string, 404 and 0.125 give no TI15; an examples.ts basename, a 6-character string, 1234 and 0.1255 each give one warn", async () => {
    expect(FIVE).toHaveLength(5);
    expect(SIX).toHaveLength(6);

    const none: Array<[string, string]> = [
      ["the source under a docs/ segment", pair("src/render.test.ts", "docs/render.ts", `"${LITERAL}"`)],
      ["the source under a fixtures/ segment", pair("src/render.test.ts", "src/fixtures/render.ts", `"${LITERAL}"`)],
      ["the source under a bench/ segment", pair("src/render.test.ts", "src/bench/render.ts", `"${LITERAL}"`)],
      ["the test under an examples/ segment", pair("examples/basic/render.test.ts", "src/render.ts", `"${LITERAL}"`)],
      ["a 5-character string", pair("src/render.test.ts", "src/render.ts", `"${FIVE}"`)],
      ["the number 404", pair("src/render.test.ts", "src/render.ts", "404")],
      ["the number 0.125", pair("src/render.test.ts", "src/render.ts", "0.125")],
    ];
    for (const [label, diff] of none) {
      expect(signalsOf(await runDiff(diff, "block"), ID), label).toEqual([]);
    }

    const one: Array<[string, string, string]> = [
      [
        "an examples.ts basename in src/",
        pair("src/render.test.ts", "src/examples.ts", `"${LITERAL}"`),
        "src/examples.ts",
      ],
      ["a 6-character string", pair("src/render.test.ts", "src/render.ts", `"${SIX}"`), "src/render.ts"],
      ["the number 1234", pair("src/render.test.ts", "src/render.ts", "1234"), "src/render.ts"],
      ["the number 0.1255", pair("src/render.test.ts", "src/render.ts", "0.1255"), "src/render.ts"],
    ];
    for (const [label, diff, path] of one) {
      const signals = signalsOf(await runDiff(diff, "block"), ID);
      expect(signals, label).toHaveLength(1);
      expect(signals[0], label).toMatchObject({ severity: "warn", path, line: 12 });
    }

    for (const name of ["pass-examples-dir.diff", "pass-benchmark-dir.diff", "pass-short-status-code.diff"]) {
      expect(signalsOf(await runDiff(fixture(`test-integrity/TI15/${name}`), "block"), ID), name).toEqual([]);
    }
  });
});
