import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The config texts are written here: the long include entry holds a raw tab, a \n
// escape and emoji from the 78th code unit on, so code unit 80 falls inside an emoji, and another key holds a secret
// that does not change.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "vitest.config.ts";
const SECRET = "SECRET-VALUE-123";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
  base?: string;
  head?: string;
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/**
 * The JS source of the 200-code-unit include entry: a raw tab at unit 3, the two-character escape `\n` (one newline
 * code unit in the value) at unit 10, five emoji over units 77 to 86 (one starts at unit 79, the 80th), padded to 200.
 */
function longEntrySource(): { source: string; value: string } {
  const emoji = "😀".repeat(5);
  const beforeNewline = "src\tdir/a".padEnd(10, "b");
  const middle = "c".repeat(77 - 11);
  const value = `${beforeNewline}\n${middle}${emoji}`.padEnd(200, "d");
  const source = JSON.stringify(value).replaceAll("\\t", "\t");
  return { source, value };
}

const config = (include: string) =>
  [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    `    name: "${SECRET}",`,
    `    include: [${include}],`,
    "  },",
    "});",
    "",
  ].join("\n");

/** True when `text` holds a control character (C0, DEL, C1, U+2028 or U+2029). */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f) || unit === 0x2028 || unit === 0x2029) return true;
  }
  return false;
}

/** True when `text` holds a high surrogate not followed by a low one, or a low surrogate not preceded by a high one. */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const isHigh = (u: number) => u >= 0xd800 && u <= 0xdbff;
    const isLow = (u: number) => u >= 0xdc00 && u <= 0xdfff;
    if (isHigh(unit)) {
      if (!isLow(text.charCodeAt(i + 1))) return true;
      i++;
    } else if (isLow(unit)) {
      return true;
    }
  }
  return false;
}

function expectCut(text: string | undefined, label: string) {
  expect(text, `${label} is present`).toBeDefined();
  const value = text as string;
  expect(hasControl(value), `${label} holds no control character`).toBe(false);
  expect(hasLoneSurrogate(value), `${label} holds no lone surrogate`).toBe(false);
  if (value.length > 80) {
    expect(value.endsWith("…"), `${label} past 80 code units ends with …`).toBe(true);
    expect(value.length - 1, `${label} keeps at most 80 code units`).toBeLessThanOrEqual(80);
  }
}

describe("TI09: what a finding carries from the config text", () => {
  it("AC-15: a 200-code-unit include entry with a tab, a newline escape and an emoji at the 80th code unit gives a detail of at most 300 code units and cut base and head values with no control character or lone surrogate, and an unchanged secret never reaches the report", async () => {
    const { source, value } = longEntrySource();
    expect(value.length, "the include entry is 200 code units").toBe(200);
    expect(value.charCodeAt(3), "a tab").toBe(9);
    expect(value.charCodeAt(10), "a newline").toBe(10);
    expect(value.codePointAt(79), "an emoji starts at the 80th code unit").toBe(0x1f600);
    expect(source, "the source holds the raw tab").toContain("\t");
    expect(source, "the source holds the newline escape").toContain("\\n");

    const base = config('"src/**/*.test.ts"');
    const head = config(source);
    const { check } = await import("@pharn-ci/core");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diffOf(PATH, base, head) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: ["src/cart.ts", PATH],
      testIntegrityMode: { input: "block" },
      testSources: {
        base: { files: [{ path: PATH, text: base }], dropped: [] },
        head: { files: [{ path: PATH, text: head }], dropped: [] },
      },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);

    const signals = (report.testIntegrity.signals as unknown as Signal[]).filter((s) => String(s.id) === "TI09");
    expect(signals, "one TI09 signal").toHaveLength(1);
    const signal = signals[0] as Signal;
    expect(signal.detail).toContain("test.include");
    expect(signal.detail.length, "the detail is at most 300 code units").toBeLessThanOrEqual(300);
    expect(hasControl(signal.detail), "the detail holds no control character").toBe(false);
    expect(hasLoneSurrogate(signal.detail), "the detail holds no lone surrogate").toBe(false);
    expectCut(signal.base, "base");
    expectCut(signal.head, "head");
    expect(signal.head?.length, "the head value is cut").toBeGreaterThan(80);

    expect(JSON.stringify(report), "the unchanged secret is not in the report").not.toContain(SECRET);
  });
});
