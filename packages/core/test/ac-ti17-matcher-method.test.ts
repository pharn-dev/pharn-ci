import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// ti17-always-true-matcher-2, AC-4. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists, so nothing the build adds may run while this file loads. The matcher opener is built from parts,
// so this file holds none as written.

const ID = ["TI", "17"].join("");
const EXTEND = ["expect", "extend({"].join(".");

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

/** An always-true matcher written as a method over several added lines (new lines 4 to 8), then its call at line 16. */
function methodMatcher(path: string, parameter: string): string {
  return edit(
    path,
    [
      4,
      4,
      [],
      [`${EXTEND}`, `  toBeTotal(${parameter}) {`, `    return { pass: true, message: () => "" };`, "  },", "});"],
    ],
    [11, 16, ["    expect(total([2, 3])).toBe(5);"], ["    expect(total([2, 3])).toBeTotal();"]],
  );
}

describe("TI17: an always-true matcher written as a method", () => {
  it("AC-4: a jest .test.js and a vitest .test.ts that each add a multi-line method matcher whose only pass is true, and a call to it, give one TI17 warn signal per file at the line of the added assertion", async () => {
    const diff = methodMatcher("src/cart.test.js", "received") + methodMatcher("src/cart.test.ts", "received: number");
    const signals = signalsOf(await runDiff(diff), ID);
    expect(signals.map((s) => `${s.severity} ${s.path}:${s.line}`)).toEqual([
      "warn src/cart.test.js:16",
      "warn src/cart.test.ts:16",
    ]);
  });
});
