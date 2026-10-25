import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI15 exists, so nothing
// the build adds may run while the file loads.
//
// The detail names the literal's kind and length, never its text: a matched value can be a secret, and the report
// leaves the job (product rule: nothing leaves it but capped and redacted messages, never file contents or diffs).

/** The signal id, and every literal below, built from parts so this file adds none of them as written. */
const ID = ["TI", "15"].join("");
const j = (...parts: string[]) => parts.join("");

/** A modified file that adds `lines` from line `at`. */
function addLines(path: string, at: number, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -${at - 1},0 +${at},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

/** A test file adding `expect(f(<lit>))` at line 8 and a source file comparing against it at line 12. */
const pair = (test: string, source: string, written: string) =>
  addLines(test, 8, [`  expect(f(${written})).toBe(1);`]) + addLines(source, 12, [`  if (s === ${written}) return 1;`]);

/** Every substring of `text` of `min` or more characters. */
function substrings(text: string, min: number): string[] {
  const out: string[] = [];
  for (let start = 0; start + min <= text.length; start++) out.push(text.slice(start, start + min));
  return out;
}

const PRINTABLE = /^[\x20-\x7e]*$/;
const E_ACUTE = String.fromCharCode(0xe9);
const U_UMLAUT = String.fromCharCode(0xfc);
const UNICODE = j("caf", E_ACUTE, "-", U_UMLAUT);
/** Written in the diffed file as `'say "hi" \\ now'`: a double quote and a (written-escaped) backslash. */
const QUOTED = String.raw`say "hi" \\ now`;
/** 100 code units, a non-ASCII one every fourth. */
const LONG = Array.from({ length: 100 }, (_, i) => (i % 4 === 3 ? E_ACUTE : String.fromCharCode(97 + (i % 26)))).join(
  "",
);
const TWIN = j("twin", "-value");
const FAR = j("far", "-away-value");
const LONG_TEST = `tests/${"deep/".repeat(56)}long.test.ts`;

describe("TI15: the detail names kind, length and paths, and the per-file cap", () => {
  it("AC-9: details carry no literal text, only its kind and length in printable ASCII, name the first test file or fall back past 300 characters, and 25 matches give 20 signals on the lowest lines", async () => {
    const details: string[] = [];

    // Each literal is described by kind and length; no 4-character piece of it reaches the detail.
    for (const [name, literal, written] of [
      ["non-ASCII", UNICODE, `"${UNICODE}"`],
      ["quote and backslash", QUOTED, `'${QUOTED}'`],
      ["100 characters", LONG, `"${LONG}"`],
    ] as const) {
      const signals = signalsOf(await runDiff(pair("src/lit.test.ts", "src/lit.ts", written)), ID);
      expect(signals, name).toHaveLength(1);
      const detail = signals[0]?.detail ?? "";
      details.push(detail);
      expect(detail, name).toContain(`a ${literal.length}-character string literal`);
      expect(detail, name).toContain('"src/lit.ts:12"');
      expect(detail, name).toContain('"src/lit.test.ts"');
      for (const piece of substrings(literal, 4)) expect(detail, `${name}: ${piece}`).not.toContain(piece);
    }

    // A number is described the same way.
    const number = j("12", "34");
    const numbers = signalsOf(await runDiff(pair("src/num.test.ts", "src/num.ts", number)), ID);
    expect(numbers).toHaveLength(1);
    const numberDetail = numbers[0]?.detail ?? "";
    details.push(numberDetail);
    expect(numberDetail).toContain("a 4-character number literal");
    expect(numberDetail).not.toContain(number);

    // A literal two test files add names the first of them in code-unit order.
    const twin =
      addLines("src/b.test.ts", 8, [`  expect(f("${TWIN}")).toBe(1);`]) +
      addLines("src/a.test.ts", 8, [`  expect(f("${TWIN}")).toBe(1);`]) +
      addLines("src/twin.ts", 12, [`  if (s === "${TWIN}") return 1;`]);
    const twinSignals = signalsOf(await runDiff(twin), ID);
    expect(twinSignals).toHaveLength(1);
    const twinDetail = twinSignals[0]?.detail ?? "";
    details.push(twinDetail);
    expect(twinDetail).toContain("src/a.test.ts");
    expect(twinDetail).not.toContain("src/b.test.ts");
    expect(twinDetail).not.toContain(TWIN);

    // A test path that would push the detail past 300 characters is replaced by "a test file in this change".
    expect(LONG_TEST.length).toBeGreaterThan(280);
    const far = signalsOf(await runDiff(pair(LONG_TEST, "src/far.ts", `"${FAR}"`)), ID);
    expect(far).toHaveLength(1);
    const farDetail = far[0]?.detail ?? "";
    details.push(farDetail);
    expect(farDetail).toContain("a test file in this change");
    expect(farDetail).not.toContain(LONG_TEST);
    expect(farDetail).toContain(`a ${FAR.length}-character string literal`);
    expect(farDetail).not.toContain(FAR);

    // 25 matching condition literals in one source file give exactly 20 signals, on its lowest lines.
    const values = Array.from({ length: 25 }, (_, i) => j("lit-value-", String(i + 1).padStart(2, "0")));
    const many =
      addLines(
        "src/many.test.ts",
        8,
        values.map((v) => `  expect(f("${v}")).toBe(1);`),
      ) +
      addLines(
        "src/many.ts",
        10,
        values.map((v, i) => `  if (s === "${v}") return ${i};`),
      );
    const manySignals = signalsOf(await runDiff(many), ID);
    details.push(...manySignals.map((s) => s.detail));
    expect(manySignals.map((s) => `${s.path}:${s.line}`)).toEqual(
      Array.from({ length: 20 }, (_, i) => `src/many.ts:${10 + i}`),
    );

    for (const detail of details) {
      expect(detail.length, detail).toBeGreaterThan(0);
      expect(detail.length, detail).toBeLessThanOrEqual(300);
      expect(detail, detail).toMatch(PRINTABLE);
    }
  });
});
