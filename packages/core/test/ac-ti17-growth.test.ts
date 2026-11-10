import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";

// ti17-always-true-matcher-2, AC-20. check() is loaded inside the test body (through runDiff): the AC test is written
// before TI17 exists. A control first shows TI17 is live (the vitest Skylos diff gives one), so the bound below is
// measured on a tree where the detector runs. The hostile fragments are built from parts, so this file holds none as
// written.

const ID = ["TI", "17"].join("");
const EXTEND = ["expect", "extend({"].join(".");
const ANYTHING = ["expect", "anything()"].join(".");
const LINES = 5000;
const WIDTH = 400;

/** A line of exactly WIDTH characters built by repeating the fragment. */
function line(fragment: string): string {
  return fragment.repeat(Math.ceil(WIDTH / fragment.length)).slice(0, WIDTH);
}

const JS_FRAGMENTS = [
  `${EXTEND} toBeX: () => ({ pass: `,
  "(([{[{(([{ pass: pass: true, pass ",
  `  toBeX(r) { return { pass: true, `,
  `expect(a).toBe(${ANYTHING}).toBeX( `,
  "'\"`\\'\"` // pass: true ({[ ",
];
const PY_FRAGMENTS = [
  "def h(value): ",
  "    return True ",
  "assert h(h(h(h((((([[[ == ANY ",
  "self.assertTrue(h((( == mock.ANY, ",
  "    def h2(v):  return True  # == ANY ",
];

function added(path: string, fragments: string[]): string {
  const body = Array.from({ length: LINES }, (_, i) => `+${line(fragments[i % fragments.length] as string)}`);
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${LINES} @@`,
    ...body,
    "",
  ].join("\n");
}

describe("TI17: a bounded scan of hostile test-file lines", () => {
  it("AC-20: 5000 hostile lines of 400 characters in a .test.ts and in a test_*.py file give a schema-valid report in under 5 seconds, with at most one TI17 signal per file", async () => {
    const control = signalsOf(await runDiff(fixture("skylos-nine/always-true-matcher/change.diff")), ID);
    expect(
      control.map((s) => `${s.severity} ${s.path}:${s.line}`),
      "control: TI17 is live",
    ).toEqual(["warn src/cart.test.ts:9"]);

    const diff = added("src/big.test.ts", JS_FRAGMENTS) + added("tests/test_big.py", PY_FRAGMENTS);
    const started = performance.now();
    const report = await runDiff(diff);
    const elapsed = performance.now() - started;
    expect(elapsed, `check() took ${Math.round(elapsed)} ms`).toBeLessThan(5000);
    const signals = signalsOf(report, ID);
    for (const path of ["src/big.test.ts", "tests/test_big.py"]) {
      expect(signals.filter((s) => s.path === path).length, path).toBeLessThanOrEqual(1);
    }
  });
});
