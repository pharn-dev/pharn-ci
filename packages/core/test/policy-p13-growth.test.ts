import { describe, expect, it } from "vitest";
import { codeownersWidenings } from "../src/policy/selfmod/codeowners.js";
import { workflowWidenings } from "../src/policy/selfmod/workflows.js";
import { measureGrowth, threadCpuMs } from "./growth.js";

// Org-policy rule P13: the two CodeQL js/polynomial-redos witnesses, through the public comparisons. The workflow
// reader's `key: value` pattern was `\s+(.*)$` after the colon: a line `-:` + tabs + U+2028 made `.` stop short of the
// end and every split of the tabs was tried. The CODEOWNERS comment strip was `(^|[^\\])#.*$`: a line of `[#` ending in
// U+2028 retried `.*$` from every `#`. Growth is measured on this thread's CPU time with measureGrowth (growth.ts), after
// a checked warm-up call of each input: 400,000 characters must take under 8 times as long as 100,000 (near 4 is
// linear, near 16 quadratic), and the slowest single call must finish within 15 s of CPU time. No wall-clock budget.

const SMALL = 100_000;
const LARGE = 400_000;

/** `prefix`, then `unit` repeated, then `suffix`, `size` characters in all. */
const sized = (prefix: string, unit: string, suffix: string, size: number) =>
  `${prefix}${unit.repeat(Math.ceil((size - prefix.length - suffix.length) / unit.length))}`.slice(
    0,
    size - suffix.length,
  ) + suffix;

async function linear(label: string, small: string, large: string, read: (text: string) => unknown) {
  let slowest = 0;
  const timed = (text: string) => () => {
    const start = threadCpuMs();
    read(text);
    slowest = Math.max(slowest, threadCpuMs() - start);
  };
  const growth = await measureGrowth(timed(small), timed(large));
  expect(slowest, `${label}: the slowest call finishes within 15 s of CPU time`).toBeLessThan(15_000);
  expect(growth.ratio, `${label}: ${growth.detail}`).toBeLessThan(8);
}

describe("P13 workflow and CODEOWNERS lines are read in linear time", { timeout: 300_000 }, () => {
  const workflow = (suffix: string) => (size: number) => sized("on: push\n-:\t", "\t\t", suffix, size);
  const workflowShapes: [string, (size: number) => string, unknown][] = [
    // A line separator anywhere makes the workflow uncompared (fail closed), whatever the line.
    ['"-:\\t" + "\\t\\t" repeated + U+2028', workflow("\u{2028}x"), null],
    ['"-:\\t" + "\\t\\t" repeated + U+2029', workflow("\u{2029}x"), null],
    // The same line with nothing to defeat the pattern is read as `-: x`.
    ['"-:\\t" + "\\t\\t" repeated + "x"', workflow("x"), []],
  ];
  for (const [label, make, expected] of workflowShapes) {
    it(`workflow line ${label}: 400,000 characters take under 8 times as long as 100,000`, async () => {
      const small = make(SMALL);
      const large = make(LARGE);
      expect(small).toHaveLength(SMALL);
      expect(large).toHaveLength(LARGE);
      // Warm-up runs, checked: head only (an added workflow) and both sides.
      for (const text of [small, large]) {
        expect(workflowWidenings(null, text)).toEqual(expected);
        expect(workflowWidenings(text, text)).toEqual(expected);
      }
      await linear(label, small, large, (text) => workflowWidenings(text, text));
    });
  }

  const codeowners = (suffix: string) => (size: number) => sized("#", "[#", suffix, size);
  const codeownersShapes: [string, (size: number) => string][] = [
    ['"#" + "[#" repeated + U+2028', codeowners("\u{2028}")],
    ['"#" + "[#" repeated + U+2029', codeowners("\u{2029}")],
    ['"#" + "[#" repeated + "x"', codeowners("x")],
  ];
  for (const [label, make] of codeownersShapes) {
    it(`CODEOWNERS line ${label}: 400,000 characters take under 8 times as long as 100,000`, async () => {
      const small = make(SMALL);
      const large = make(LARGE);
      expect(small).toHaveLength(SMALL);
      expect(large).toHaveLength(LARGE);
      // Warm-up runs, checked: the same text on both sides loosens nothing; the line against a base of one rule is
      // another rule count, so it loosens.
      for (const text of [small, large]) {
        expect(codeownersWidenings(text, text)).toEqual([]);
        expect(codeownersWidenings("* @a\n", `* @a\n${text}\n`)).toEqual(text.endsWith("x") ? [] : ["rules changed"]);
      }
      await linear(label, small, large, (text) => codeownersWidenings(text, text));
    });
  }
});
