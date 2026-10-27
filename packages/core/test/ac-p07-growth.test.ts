import { describe, expect, it } from "vitest";
import { measureGrowth } from "./growth.js";

// E3 item 24 (P07), AC-14. instructionDeclarations() is loaded inside the test body: the AC test is written before the
// build adds the extractor, so nothing the build adds may run while this file loads. The hostile texts are generated
// here, at 100,000 and 400,000 characters.

type Tools = { tools: string[]; line: number | null };
type Declarations = { patternScoped: boolean; packageManagers: Tools; testRunners: Tools };
interface Core {
  instructionDeclarations(text: string): Declarations;
}

const SMALL = 100_000;
const LARGE = 400_000;

/** `prefix`, then `unit` repeated, then `suffix`, cut in the repeated part to exactly `size` characters. */
function sized(prefix: string, unit: string, suffix: string, size: number): string {
  const room = size - prefix.length - suffix.length;
  const body = unit.repeat(Math.ceil(room / unit.length)).slice(0, room);
  const text = `${prefix}${body}${suffix}`;
  expect(text).toHaveLength(size);
  return text;
}

/** (a) One line of backtick runs of growing lengths 1, 2, 3, …: no run has an equal-length partner. */
function backtickRuns(size: number): string {
  let line = "";
  for (let k = 1; line.length < size; k++) line += `${"`".repeat(k)}a`;
  return line.slice(0, size);
}

/** (b) Fence-open lines of alternating characters, so no line closes the fence the previous one opened. */
const fenceLines = (size: number) => sized("", "```sh\nnpm install\n~~~sh\n", "", size);
/** (c) One shell line of `npm && ` repeated. */
const shellChain = (size: number) => sized("```sh\n", "npm && ", "\n```\n", size);
/** (d) An unclosed `<!--`, then lines holding code spans and further openers, never a `-->`. */
const openComment = (size: number) => sized("<!--\n", "Run `npm install` <!-- here.\n", "", size);

const SHAPES: [string, (size: number) => string][] = [
  ["(a) unmatched backtick runs of varying lengths", backtickRuns],
  ["(b) alternating fence-open lines", fenceLines],
  ["(c) one sh line of `npm && ` repeated", shellChain],
  ["(d) an unclosed <!--", openComment],
];

describe("org policy rule P07: the extractor is linear", { timeout: 300_000 }, () => {
  it("AC-14: on four hostile shapes, instructionDeclarations on 400,000 characters takes under 8 times as long as on 100,000", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    expect(typeof core.instructionDeclarations).toBe("function");

    for (const [label, make] of SHAPES) {
      const small = make(SMALL);
      const large = make(LARGE);
      expect(small, label).toHaveLength(SMALL);
      expect(large, label).toHaveLength(LARGE);

      // Warm-up runs, checked: each returns the declarations shape without throwing.
      for (const text of [small, large]) {
        const declared = core.instructionDeclarations(text);
        expect(Array.isArray(declared.packageManagers.tools), label).toBe(true);
        expect(Array.isArray(declared.testRunners.tools), label).toBe(true);
      }
      expect(core.instructionDeclarations(shellChain(SMALL)).packageManagers.tools).toEqual(["npm"]);

      const growth = await measureGrowth(
        () => core.instructionDeclarations(small),
        () => core.instructionDeclarations(large),
      );
      expect(growth.ratio, `${label}: ${growth.detail}`).toBeLessThan(8);
    }
  });
});
