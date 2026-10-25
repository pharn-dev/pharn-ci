import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI02, TI05 and their cap exist, so nothing
// that depends on them may run while the file loads. The base and head texts and the diff are generated here, so the
// expected lines are known without a fixture.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CART = "src/cart.test.ts";
const TOTALS = "src/totals.test.ts";
const HEADER = ['import { describe, expect, it } from "vitest";', 'import { total } from "./cart.js";', ""];

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[]; languages: string[] };
  messages: { code: string; level: string; text: string }[];
}

/** A `--unified=0` diff of `path` that removes the base lines whose index `removed` holds (0-based). */
function deletionDiff(path: string, baseLines: readonly string[], removed: ReadonlySet<number>): string {
  const out = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  let kept = 0;
  for (let i = 0; i < baseLines.length; ) {
    if (!removed.has(i)) {
      kept++;
      i++;
      continue;
    }
    let j = i;
    while (j < baseLines.length && removed.has(j)) j++;
    out.push(`@@ -${i + 1},${j - i} +${kept},0 @@`, ...baseLines.slice(i, j).map((line) => `-${line}`));
    i = j;
  }
  return `${out.join("\n")}\n`;
}

/** Base lines 1-based of every `it` line in `lines` that matches `pattern`. */
const linesOf = (lines: readonly string[], pattern: RegExp) =>
  lines.flatMap((line, i) => (pattern.test(line) ? [i + 1] : []));

describe("TI02 and TI05: at most 20 findings per file per signal", () => {
  it("AC-11: 23 removed tests give 20 TI02 (18 block, the 2 lowest .each warns), 22 emptied tests give 20 TI05, and each message says how many were not listed for its file", async () => {
    // src/cart.test.ts: five .each tests on the lowest base lines, eighteen named tests after them and one kept test.
    // Every body is distinct and none is similar to a test left at head.
    const cartBase = [...HEADER];
    for (let i = 0; i < 5; i++) {
      cartBase.push(
        `it.each([[${i}, ${i + 1}]])("adds %s in table ${i}", (a, b) => {`,
        `  expect(table${i}Sum(a, b)).toBe(a + b + ${i});`,
        "});",
      );
    }
    for (let i = 0; i < 18; i++) {
      cartBase.push(`it("named case ${i}", () => {`, `  expect(named${i}Value()).toEqual({ id: ${i} });`, "});");
    }
    cartBase.push('it("keeps working", () => {', "  expect(total([])).toBe(0);", "});", "");
    const cartRemoved = new Set(Array.from({ length: 23 * 3 }, (_, k) => HEADER.length + k));
    const cartHead = cartBase.filter((_, i) => !cartRemoved.has(i));
    const eachLines = linesOf(cartBase, /^it\.each\(/);
    const namedLines = linesOf(cartBase, /^it\("named case /);
    expect(eachLines).toHaveLength(5);
    expect(namedLines).toHaveLength(18);

    // src/totals.test.ts: 22 tests that each lose both of their assertions and call no helper.
    const totalsBase = [...HEADER];
    const totalsRemoved = new Set<number>();
    for (let i = 0; i < 22; i++) {
      totalsBase.push(`it("total case ${i}", () => {`, `  const sum${i} = total([${i}, ${i + 2}]);`);
      totalsRemoved.add(totalsBase.length);
      totalsBase.push(`  expect(sum${i}).toBe(${2 * i + 2});`);
      totalsRemoved.add(totalsBase.length);
      totalsBase.push(`  expect(sum${i}).toBeGreaterThan(${i});`, "});");
    }
    totalsBase.push("");
    const totalsHead = totalsBase.filter((_, i) => !totalsRemoved.has(i));

    const text = (lines: string[]) => lines.join("\n");
    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: deletionDiff(CART, cartBase, cartRemoved) + deletionDiff(TOTALS, totalsBase, totalsRemoved) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [CART, "src/cart.ts", TOTALS],
      testSources: {
        base: {
          files: [
            { path: CART, text: text(cartBase) },
            { path: TOTALS, text: text(totalsBase) },
          ],
          dropped: [],
        },
        head: {
          files: [
            { path: CART, text: text(cartHead) },
            { path: TOTALS, text: text(totalsHead) },
          ],
          dropped: [],
        },
      },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
    expect(ti02).toHaveLength(20);
    expect(ti02.every((s) => s.path === CART)).toBe(true);
    const blocks = ti02.filter((s) => s.severity === "block");
    const warns = ti02.filter((s) => s.severity === "warn");
    expect(blocks.map((s) => s.line).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(namedLines);
    expect(warns.map((s) => s.line).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(eachLines.slice(0, 2));

    const ti05 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI05");
    expect(ti05).toHaveLength(20);
    expect(ti05.every((s) => s.path === TOTALS && s.severity === "block")).toBe(true);

    const message = (code: string) => {
      const found = report.messages.filter((m) => String(m.code) === code);
      expect(found, code).toHaveLength(1);
      return (found[0] as { text: string }).text;
    };
    const ti02Text = message("TEST_INTEGRITY_TI02");
    expect(ti02Text).toContain(CART);
    expect(ti02Text, "3 TI02 findings not listed for src/cart.test.ts").toMatch(/\b3\b/);
    const ti05Text = message("TEST_INTEGRITY_TI05");
    expect(ti05Text).toContain(TOTALS);
    expect(ti05Text, "2 TI05 findings not listed for src/totals.test.ts").toMatch(/\b2\b/);
  });
});
