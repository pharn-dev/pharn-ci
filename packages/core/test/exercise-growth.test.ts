import { describe, expect, it } from "vitest";
import type { DiffFile } from "../src/diff/unified.js";
import { detectUnexercisedChanges } from "../src/signals/exercise.js";
import type { AddedTestFile } from "../src/signals/testPairs.js";
import type { TestBlock } from "../src/testIndex/types.js";
import { measureGrowth, threadCpuMs } from "./growth.js";

// A8 step 1: the tests-exercise check is linear in what it reads. Each import specifier is joined and tried against at
// most 17 candidate paths, and each changed file is classified once, so four times the specifiers (or four times the
// length of one specifier, or four times the changed files) must take under 8 times as long (near 4 is linear, near 16
// quadratic), on this thread's CPU time with measureGrowth after a checked warm-up, and the slowest single call must
// finish within 15 s of CPU time. No wall-clock budget.

const ASSERTED: TestBlock = {
  kind: "test",
  name: "t",
  nameDynamic: false,
  path: ["t"],
  line: 1,
  endLine: 1,
  modifiers: [],
  body: "",
  bodyHash: "00000000",
  assertionCount: 1,
  assertions: [],
  guards: [],
};

const changed = (path: string): DiffFile => ({ path, oldPath: path, status: "modified", addedLines: [1] });
const addedTest = (headPath: string, headImports: string[]): AddedTestFile => ({
  headPath,
  head: [ASSERTED],
  headMocks: [],
  headImports,
});

async function linear(label: string, small: () => unknown, large: () => unknown) {
  let slowest = 0;
  const timed = (run: () => unknown) => () => {
    const start = threadCpuMs();
    run();
    slowest = Math.max(slowest, threadCpuMs() - start);
  };
  const growth = await measureGrowth(timed(small), timed(large));
  expect(slowest, `${label}: the slowest call finishes within 15 s of CPU time`).toBeLessThan(15_000);
  expect(growth.ratio, `${label}: ${growth.detail}`).toBeLessThan(8);
}

describe("the tests-exercise check runs in linear time", { timeout: 300_000 }, () => {
  it("many specifiers: 40,000 take under 8 times as long as 10,000", async () => {
    const make = (n: number) => {
      const imports = Array.from({ length: n }, (_, i) => `../lib/m${i}`);
      const diff = [changed("src/a.ts"), { ...changed("src/a.test.ts"), status: "added" as const }];
      return () =>
        detectUnexercisedChanges(diff, { pairs: [], added: [addedTest("src/a.test.ts", imports)] }, [], () => false);
    };
    const small = make(10_000);
    const large = make(40_000);
    for (const run of [small, large]) expect(run()).toEqual({ checked: 1, notExercised: ["src/a.ts"] });
    await linear("specifiers", small, large);
  });

  it("one long specifier: 400,000 characters take under 8 times as long as 100,000", async () => {
    const make = (size: number) => {
      const specifier = `./${"d/".repeat(Math.floor((size - 3) / 2))}a`;
      const diff = [changed("src/a.ts"), { ...changed("src/a.test.ts"), status: "added" as const }];
      return () =>
        detectUnexercisedChanges(
          diff,
          { pairs: [], added: [addedTest("src/a.test.ts", [specifier])] },
          [],
          () => false,
        );
    };
    const small = make(100_000);
    const large = make(400_000);
    for (const run of [small, large]) expect(run()).toEqual({ checked: 1, notExercised: ["src/a.ts"] });
    await linear("long specifier", small, large);
  });

  it("many changed files: 20,000 take under 8 times as long as 5,000", async () => {
    const make = (n: number) => {
      const diff = Array.from({ length: n }, (_, i) => changed(`src/f${i}.ts`));
      const imports = Array.from({ length: n }, (_, i) => `./f${i}`);
      return () =>
        detectUnexercisedChanges(
          [...diff, { ...changed("src/all.test.ts"), status: "added" }],
          { pairs: [], added: [addedTest("src/all.test.ts", imports)] },
          [],
          () => false,
        );
    };
    const small = make(5_000);
    const large = make(20_000);
    for (const [run, n] of [
      [small, 5_000],
      [large, 20_000],
    ] as const) {
      expect(run()).toEqual({ checked: n, notExercised: [] });
    }
    await linear("changed files", small, large);
  });
});
