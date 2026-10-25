import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI06, TI12 and their messages exist, so nothing
// that depends on them may run while the file loads. The base and head texts and the diff are generated here, so the
// expected findings are known without a fixture. No path or name holds a digit, so a count in a message text is the
// cap's count.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CART = "src/cart.test.ts";
const MOCKS = "src/mocks.test.ts";
const HEADER = ['import { describe, expect, it, vi } from "vitest";', 'import { total } from "./cart.js";', ""];
/** 22 distinct names with no digit: a, b, …, v. */
const NAMES = Array.from({ length: 22 }, (_, i) => String.fromCharCode(97 + i));
const SOURCES = NAMES.map((n) => `src/part-${n}.ts`);

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

/** A `--unified=0` diff of `path` that replaces base line i (0-based) with head line i wherever they differ. */
function replaceDiff(path: string, base: readonly string[], head: readonly string[]): string {
  const out = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  base.forEach((line, i) => {
    if (line !== head[i]) out.push(`@@ -${i + 1} +${i + 1} @@`, `-${line}`, `+${head[i]}`);
  });
  return `${out.join("\n")}\n`;
}

/** A `--unified=0` diff of `path` that inserts `added` after base line `after` (1-based). */
function insertDiff(path: string, after: number, added: readonly string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${after},0 +${after + 1},${added.length} @@`,
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");
}

/** A one-line modification of a source file. */
const sourceDiff = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "+export const value = 2;",
    "",
  ].join("\n");

describe("TI06 and TI12: at most 20 findings per file per signal", () => {
  it("AC-13: 22 downgraded tests give 20 TI06, 22 new mocks of modified sources give 20 TI12, and each message says 2 findings were not listed for its file", async () => {
    // src/cart.test.ts: 22 tests whose toBe(5) becomes toBeTruthy(); nothing else changes.
    const cartBase = [...HEADER, 'describe("cart", () => {'];
    for (const n of NAMES)
      cartBase.push(`  it("case ${n}", () => {`, `    expect(value${n.toUpperCase()}()).toBe(5);`, "  });");
    cartBase.push("});", "");
    const cartHead = cartBase.map((line) => line.replace(".toBe(5);", ".toBeTruthy();"));
    const testLines = cartHead.flatMap((line, i) => (/^ {2}it\("case /.test(line) ? [i + 1] : []));
    expect(testLines).toHaveLength(22);

    // src/mocks.test.ts: one unchanged test; head adds 22 vi.mock calls after the imports, one per modified source.
    const mocksBase = [...HEADER, 'it("uses the parts", () => {', "  expect(total([])).toBe(0);", "});", ""];
    const mockLines = NAMES.map((n) => `vi.mock("./part-${n}");`);
    const mocksHead = [...HEADER.slice(0, 2), ...mockLines, ...mocksBase.slice(2)];

    const text = (lines: string[]) => lines.join("\n");
    const diff =
      replaceDiff(CART, cartBase, cartHead) + insertDiff(MOCKS, 2, mockLines) + SOURCES.map(sourceDiff).join("");
    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [CART, "src/cart.ts", MOCKS, ...SOURCES].sort(),
      testSources: {
        base: {
          files: [
            { path: CART, text: text(cartBase) },
            { path: MOCKS, text: text(mocksBase) },
          ],
          dropped: [],
        },
        head: {
          files: [
            { path: CART, text: text(cartHead) },
            { path: MOCKS, text: text(mocksHead) },
          ],
          dropped: [],
        },
      },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const ti06 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
    expect(ti06).toHaveLength(20);
    expect(ti06.every((s) => s.path === CART && s.severity === "warn")).toBe(true);
    for (const s of ti06) expect(testLines, "each at a downgraded test's head line").toContain(s.line);

    const ti12 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI12");
    expect(ti12).toHaveLength(20);
    expect(ti12.every((s) => s.path === MOCKS && s.severity === "warn")).toBe(true);
    expect(new Set(ti12.map((s) => s.line)).size, "one finding per target").toBe(20);

    const message = (code: string) => {
      const found = report.messages.filter((m) => String(m.code) === code);
      expect(found, code).toHaveLength(1);
      return (found[0] as { text: string }).text;
    };
    const ti06Text = message("TEST_INTEGRITY_TI06");
    expect(ti06Text).toContain(CART);
    expect(ti06Text, "2 TI06 findings not listed for src/cart.test.ts").toMatch(/\b2\b/);
    const ti12Text = message("TEST_INTEGRITY_TI12");
    expect(ti12Text).toContain(MOCKS);
    expect(ti12Text, "2 TI12 findings not listed for src/mocks.test.ts").toMatch(/\b2\b/);
  });
});
