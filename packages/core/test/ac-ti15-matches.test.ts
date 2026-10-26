import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI15 exists, so nothing
// the build adds may run while the file loads.

/** The signal id, and every matching literal below, built from parts so this file adds none of them as written. */
const ID = ["TI", "15"].join("");
const j = (...parts: string[]) => parts.join("");

/** A modified file that adds `lines` from line `at`. */
function addLines(path: string, at: number, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -${at - 1},0 +${at},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

type Expected = { path: string; line: number; literal: string; test: string };
type Case = { label: string; diff: string; expected: Expected[] };

const SUMMER = j("SUMMER", "2024");
const GOLD = j("gold", "-tier");
// ABCD, XYZW and RATE keep their names; the signal-precision increment lengthened them to the 6-character and 4-digit minimums.
const ABCD = j("ab", "cdef");
const BETA = j("beta", "-user");
const ENTERPRISE = j("enter", "prise");
const ALPHA = j("alpha", "-user");
const XYZW = j("xy", "zwvu");
const N1234 = j("12", "34");
const RATE = j("0.1", "255");
const PREMIUM = j("premium", "-plan");

/** A test file adding `testLines` at line 8, and a source file adding `sourceLine` at line 12. */
function pair(test: string, testLines: string[], source: string, sourceLine: string): string {
  return addLines(test, 8, testLines) + addLines(source, 12, [sourceLine]);
}

const CASES: Case[] = [
  {
    label: "=== against a string the test adds",
    diff: pair(
      "src/discount.test.ts",
      [`  expect(price("${SUMMER}")).toBe(0);`],
      "src/discount.ts",
      `  if (code === "${SUMMER}") return 0;`,
    ),
    expected: [{ path: "src/discount.ts", line: 12, literal: SUMMER, test: "src/discount.test.ts" }],
  },
  {
    label: "a JS switch case",
    diff: pair("src/tier.test.ts", [`  expect(rank('${GOLD}')).toBe(1);`], "src/tier.ts", `    case '${GOLD}':`),
    expected: [{ path: "src/tier.ts", line: 12, literal: GOLD, test: "src/tier.test.ts" }],
  },
  {
    label: "the literal on the left of !==",
    diff: pair("src/mode.test.ts", [`  run("${ABCD}");`], "src/mode.ts", `  if ("${ABCD}" !== mode) return;`),
    expected: [{ path: "src/mode.ts", line: 12, literal: ABCD, test: "src/mode.test.ts" }],
  },
  {
    label: "== inside a ternary",
    diff: pair(
      "src/kind.test.ts",
      [`  expect(pick("${BETA}")).toBe(1);`],
      "src/kind.ts",
      `  const v = kind == "${BETA}" ? 1 : 2;`,
    ),
    expected: [{ path: "src/kind.ts", line: 12, literal: BETA, test: "src/kind.test.ts" }],
  },
  {
    label: "a Python if ==",
    diff: pair(
      "tests/test_plans.py",
      [`    assert price("${ENTERPRISE}") == 10`],
      "app/plans.py",
      `    if plan == "${ENTERPRISE}":`,
    ),
    expected: [{ path: "app/plans.py", line: 12, literal: ENTERPRISE, test: "tests/test_plans.py" }],
  },
  {
    label: "a Python elif … in (…) with both literals in the test",
    diff: pair(
      "tests/test_tiers.py",
      [`    assert early("${ALPHA}")`, `    assert early("${BETA}")`],
      "app/tiers.py",
      `    elif tier in ("${ALPHA}", "${BETA}"):`,
    ),
    expected: [
      { path: "app/tiers.py", line: 12, literal: ALPHA, test: "tests/test_tiers.py" },
      { path: "app/tiers.py", line: 12, literal: BETA, test: "tests/test_tiers.py" },
    ],
  },
  {
    label: "a Python match case",
    diff: pair("tests/test_match.py", [`    assert handle("${XYZW}") == 1`], "app/match.py", `        case "${XYZW}":`),
    expected: [{ path: "app/match.py", line: 12, literal: XYZW, test: "tests/test_match.py" }],
  },
  {
    label: "a number of four significant digits",
    diff: pair(
      "src/num.test.ts",
      [`  expect(isMagic(${N1234})).toBe(true);`],
      "src/num.ts",
      `  if (n === ${N1234}) return true;`,
    ),
    expected: [{ path: "src/num.ts", line: 12, literal: N1234, test: "src/num.test.ts" }],
  },
  {
    label: "a decimal number with != ",
    diff: pair(
      "src/rate.test.ts",
      [`  expect(adjust(${RATE})).toBe(1);`],
      "src/rate.ts",
      `  if (rate != ${RATE}) return 0;`,
    ),
    expected: [{ path: "src/rate.ts", line: 12, literal: RATE, test: "src/rate.test.ts" }],
  },
  {
    label: "a Python test paired with a TypeScript source",
    diff: pair(
      "tests/test_api.py",
      [`    assert allowed("${PREMIUM}")`],
      "src/api.ts",
      `  if (plan === "${PREMIUM}") return true;`,
    ),
    expected: [{ path: "src/api.ts", line: 12, literal: PREMIUM, test: "tests/test_api.py" }],
  },
];

describe("TI15: a new source condition compares against a literal the test adds", () => {
  it("AC-7: each matching condition literal gives one warn signal at the source path:line whose detail names the location, the literal's kind and length and the test file, never the literal", async () => {
    for (const c of CASES) {
      const signals = signalsOf(await runDiff(c.diff), ID);
      expect(
        signals.map((s) => `${s.severity} ${s.path}:${s.line}`),
        c.label,
      ).toEqual(c.expected.map((e) => `warn ${e.path}:${e.line}`));
      // The details of one line differ only in the literal's length, so both sides are compared as sorted lists.
      const expectedLine = (e: Expected) =>
        `${e.path}:${e.line} ${e.literal.length}-character ${/^[0-9]/.test(e.literal) ? "number" : "string"} ${e.test}`;
      const seen = signals.map((s) => {
        const what = /a (\d+)-character (string|number) literal/.exec(s.detail);
        const test = /the test file "([^"]+)"/.exec(s.detail);
        return `${s.path}:${s.line} ${what?.[1]}-character ${what?.[2]} ${test?.[1]}`;
      });
      expect(seen.sort(), c.label).toEqual(c.expected.map(expectedLine).sort());
      for (const s of signals) {
        expect(s.detail, c.label).toContain(`"${s.path}:${s.line}"`);
        expect(s.detail.length, c.label).toBeLessThanOrEqual(300);
        for (const e of c.expected) expect(s.detail, `${c.label}: no literal text`).not.toContain(e.literal);
      }
    }
  });
});
