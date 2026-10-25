import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI07 exists, so nothing that depends on it may
// run while the file loads. The base and head texts and the diff are generated here, so the expected lines are known
// without a fixture.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CART = "src/cart.test.ts";
const SOURCE = "src/cart.ts";
const COUNT = 25;
const MESSAGE_PREFIX =
  "This change edits only the expected values of tests while it also edits source files, so the tests may have been made to agree with the code: ";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
}

/** One test file of 25 tests; at head each test's `toBe(<n>)` expected value differs, and nothing else does. */
function texts(): { base: string[]; head: string[]; changed: number[]; testLines: number[] } {
  const header = ['import { describe, expect, it } from "vitest";', 'import { price } from "./cart.js";', ""];
  const base = [...header, 'describe("cart", () => {'];
  const head = [...base];
  const changed: number[] = [];
  const testLines: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    testLines.push(base.length + 1);
    base.push(`  it("prices item ${i}", () => {`);
    head.push(`  it("prices item ${i}", () => {`);
    changed.push(base.length + 1);
    base.push(`    expect(price(${i})).toBe(${i * 10 + 1});`);
    head.push(`    expect(price(${i})).toBe(${i * 10 + 2});`);
    base.push("  });");
    head.push("  });");
  }
  base.push("});", "");
  head.push("});", "");
  return { base, head, changed, testLines };
}

/** A `--unified=0` diff that swaps each changed line of the test file, plus a one-line edit of the source file. */
function diffOf(base: string[], head: string[], changed: number[]): string {
  const out = [`diff --git a/${CART} b/${CART}`, "index 1111111..2222222 100644", `--- a/${CART}`, `+++ b/${CART}`];
  for (const line of changed) out.push(`@@ -${line} +${line} @@`, `-${base[line - 1]}`, `+${head[line - 1]}`);
  out.push(
    `diff --git a/${SOURCE} b/${SOURCE}`,
    "index 3333333..4444444 100644",
    `--- a/${SOURCE}`,
    `+++ b/${SOURCE}`,
    "@@ -2 +2 @@",
    "-  return item * 10 + 1;",
    "+  return item * 10 + 2;",
  );
  return `${out.join("\n")}\n`;
}

describe("TI07: at most 20 findings per file", () => {
  it("AC-5: 25 tests of one file that each change only an expected value, with a source file changed, give 20 TI07 signals for that file, a message naming it that ends with the cap's Not listed sentence giving 5, and no TI02 or TI05", async () => {
    const { base, head, changed, testLines } = texts();
    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diffOf(base, head, changed) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [CART, SOURCE],
      testSources: {
        base: { files: [{ path: CART, text: base.join("\n") }], dropped: [] },
        head: { files: [{ path: CART, text: head.join("\n") }], dropped: [] },
      },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const ti07 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI07");
    expect(ti07).toHaveLength(20);
    for (const signal of ti07) {
      expect(signal.path).toBe(CART);
      expect(signal.severity).toBe("warn");
      expect(testLines, `line ${signal.line} is a test's head line`).toContain(signal.line);
    }
    expect(new Set(ti07.map((s) => s.line)).size, "20 different tests").toBe(20);

    const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI07");
    expect(messages).toHaveLength(1);
    const text = (messages[0] as { text: string }).text;
    expect(text.startsWith(MESSAGE_PREFIX)).toBe(true);
    expect(text).toContain(`\`${CART}\``);
    expect(text, "ends with the cap's Not listed sentence giving 5").toMatch(
      /\. Check that each new expected value is right\. Not listed: [^\n]*\b5\b[^\n]*\.$/,
    );

    expect(report.testIntegrity.signals.filter((s) => ["TI02", "TI05"].includes(String(s.id)))).toEqual([]);
  });
});
