import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// summarizeTestChanges, matchTests, the test-file pairing, the diff parser and check() are loaded inside each test
// body: the AC tests are written before the tests-changed summary exists, so nothing that depends on it may run while
// the file loads. The test sources and the diff are generated here, so every expected entry is known without a fixture.

const REPO_ROOT = "/home/runner/work/demo/demo";
const MAX_ENTRIES = 200;
const MAX_NAME = 120;
const PER_KIND = 30;
const FILES = ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts"];
const HEADER = ['import { expect, it } from "vitest";', 'import * as cart from "./cart.js";', ""];
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

interface Entry {
  path: string;
  name: string;
  line: number;
}
interface Changes {
  totals: { added: number; removed: number; modified: number; renamed: number };
  files: Array<{ path: string; language: string; added: number; removed: number; modified: number; renamed: number }>;
  added: Entry[];
  removed: Entry[];
  modified: Entry[];
  renamed: Entry[];
  truncated?: number;
}
interface SourceFile {
  path: string;
  text: string;
}
interface Generated {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
  expected: { added: Entry[]; removed: Entry[]; modified: Entry[]; renamed: Entry[] };
}

const byPathThenLine = (a: Entry, b: Entry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line);

/** A diff of a modified file that replaces every base line with every head line (one hunk). */
function modifiedDiff(path: string, base: string[], head: string[]): string[] {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${base.length} +1,${head.length} @@`,
    ...base.map((l) => `-${l}`),
    ...head.map((l) => `+${l}`),
  ];
}

/** A diff that adds a file. */
function addedDiff(path: string, head: string[]): string[] {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${head.length} @@`,
    ...head.map((l) => `+${l}`),
  ];
}

/**
 * Three modified test files, each with 30 removed tests, 30 tests whose body changes under the same name, 30 tests
 * renamed with the same body, and 30 added tests: 360 changes in all. Every body has its own identifiers, so no
 * removed or added test is similar to another test.
 */
function overCap(): Generated {
  const diff: string[] = [];
  const base: SourceFile[] = [];
  const head: SourceFile[] = [];
  const expected = { added: [] as Entry[], removed: [] as Entry[], modified: [] as Entry[], renamed: [] as Entry[] };
  FILES.forEach((path, f) => {
    const b = [...HEADER];
    const h = [...HEADER];
    for (let i = 0; i < PER_KIND; i++) {
      const k = `${f}x${i}`;
      expected.removed.push({ path, name: `drops case ${k}`, line: b.length + 1 });
      b.push(`it("drops case ${k}", () => {`, `  const gone${k} = cart.dropped${k}("r${k}");`);
      b.push(`  expect(gone${k}).toStrictEqual({ dropKey${k}: true });`, "});");

      b.push(`it("edits case ${k}", () => {`, `  expect(cart.edited${k}()).toBe(${i});`, "});");
      expected.modified.push({ path, name: `edits case ${k}`, line: h.length + 1 });
      h.push(`it("edits case ${k}", () => {`, `  expect(cart.edited${k}()).toBe(${i + 1000});`, "});");

      b.push(`it("old name ${k}", () => {`, `  expect(cart.renamed${k}(${i})).toEqual([${i}]);`, "});");
      expected.renamed.push({ path, name: `new name ${k}`, line: h.length + 1 });
      h.push(`it("new name ${k}", () => {`, `  expect(cart.renamed${k}(${i})).toEqual([${i}]);`, "});");
    }
    for (let i = 0; i < PER_KIND; i++) {
      const k = `${f}y${i}`;
      expected.added.push({ path, name: `adds case ${k}`, line: h.length + 1 });
      h.push(`it("adds case ${k}", () => {`, `  const made${k} = cart.fresh${k}([${i}, ${i + 7}]);`);
      h.push(`  expect(made${k}.size${k}).toBeGreaterThan(${i + 3});`, "});");
    }
    b.push("");
    h.push("");
    diff.push(...modifiedDiff(path, b.slice(0, -1), h.slice(0, -1)));
    base.push({ path, text: b.join("\n") });
    head.push({ path, text: h.join("\n") });
  });
  for (const list of Object.values(expected)) list.sort(byPathThenLine);
  return { diff: `${diff.join("\n")}\n`, base, head, expected };
}

/** An added test file whose tests have a name with control characters and two names longer than 120 units. */
function names(): { gen: Generated; control: string; surrogate: string; plain: string } {
  const path = "src/names.test.ts";
  const control = `ctl${String.fromCharCode(9)}name${String.fromCharCode(7)}x`;
  const surrogate = `${"a".repeat(118)}\u{1F600}${"b".repeat(20)}`;
  const plain = "c".repeat(150);
  const h = [...HEADER];
  h.push(`it("${control}", () => {`, "  expect(cart.one()).toBe(1);", "});");
  h.push(`it("${surrogate}", () => {`, "  expect(cart.two()).toBe(2);", "});");
  h.push(`it("${plain}", () => {`, "  expect(cart.three()).toBe(3);", "});", "");
  return {
    gen: {
      diff: `${addedDiff(path, h.slice(0, -1)).join("\n")}\n`,
      base: [],
      head: [{ path, text: h.join("\n") }],
      expected: { added: [], removed: [], modified: [], renamed: [] },
    },
    control,
    surrogate,
    plain,
  };
}

async function summarize(gen: Generated): Promise<Changes | null> {
  const { parseUnifiedDiff } = await import("../src/diff/unified.js");
  const { indexTouchedTestFiles } = await import("../src/signals/testPairs.js");
  const { matchTests } = await import("../src/signals/testMatch.js");
  const { summarizeTestChanges } = (await import("../src/signals/testChanges.js")) as unknown as {
    summarizeTestChanges(touched: unknown, match: unknown): Changes | null;
  };
  const sources = { base: { files: gen.base, dropped: [] }, head: { files: gen.head, dropped: [] } };
  const touched = indexTouchedTestFiles(parseUnifiedDiff(gen.diff), sources as never, undefined);
  return summarizeTestChanges(touched, matchTests(touched));
}

async function checkReport(gen: Generated): Promise<{ testIntegrity: { changes?: Changes } }> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: gen.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...gen.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: gen.base, dropped: [] }, head: { files: gen.head, dropped: [] } },
    testIntegrityMode: { input: "warn" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as { testIntegrity: { changes?: Changes } };
}

const isSorted = (list: Entry[]) => list.every((e, i) => i === 0 || byPathThenLine(list[i - 1] as Entry, e) <= 0);

describe("the tests-changed summary caps", () => {
  it("AC-10: more than 200 changes across several files keep exactly 200 entries filled removed, modified, renamed, then added, each sorted, with truncated, totals and files counting every test", async () => {
    const gen = overCap();
    const total = PER_KIND * 4 * FILES.length;
    expect(total).toBeGreaterThan(MAX_ENTRIES);

    const summary = await summarize(gen);
    expect(summary, "a summary").not.toBeNull();
    const s = summary as Changes;
    expect(s.removed.length + s.modified.length + s.renamed.length + s.added.length).toBe(MAX_ENTRIES);
    // Fill order: removed, then modified, then renamed, then added, each taken in path-then-line order.
    expect(s.removed).toEqual(gen.expected.removed);
    expect(s.modified).toEqual(gen.expected.modified);
    const renamedRoom = MAX_ENTRIES - gen.expected.removed.length - gen.expected.modified.length;
    expect(renamedRoom).toBeGreaterThan(0);
    expect(renamedRoom).toBeLessThan(gen.expected.renamed.length);
    expect(s.renamed).toEqual(gen.expected.renamed.slice(0, renamedRoom));
    expect(s.added).toEqual([]);
    for (const list of [s.removed, s.modified, s.renamed, s.added]) expect(isSorted(list)).toBe(true);
    expect(s.truncated).toBe(total - MAX_ENTRIES);

    expect(s.totals).toEqual({
      added: PER_KIND * FILES.length,
      removed: PER_KIND * FILES.length,
      modified: PER_KIND * FILES.length,
      renamed: PER_KIND * FILES.length,
    });
    expect(s.files).toEqual(
      FILES.map((path) => ({
        path,
        language: "ts",
        added: PER_KIND,
        removed: PER_KIND,
        modified: PER_KIND,
        renamed: PER_KIND,
      })),
    );

    const report = await checkReport(gen);
    expect(report.testIntegrity.changes, "check() reports the same summary").toEqual(s);
  });

  it("AC-10: control characters in a name become spaces, and a name longer than 120 UTF-16 units is cut to at most 120 ending with … and no lone surrogate", async () => {
    const { gen, control, surrogate, plain } = names();
    const summary = await summarize(gen);
    expect(summary, "a summary").not.toBeNull();
    const s = summary as Changes;
    expect(s.added).toHaveLength(3);
    expect("truncated" in s, "under the cap").toBe(false);
    const [first, second, third] = [...s.added].sort((a, b) => a.line - b.line) as [Entry, Entry, Entry];

    // The tab (U+0009) and the bell (U+0007) of the name are spaces.
    expect(first.name).toBe("ctl name x");
    expect(control.length).toBe(first.name.length);

    for (const [entry, source] of [
      [second, surrogate],
      [third, plain],
    ] as const) {
      expect(source.length).toBeGreaterThan(MAX_NAME);
      expect(entry.name.length, "at most 120 UTF-16 units").toBeLessThanOrEqual(MAX_NAME);
      expect(entry.name.endsWith("…")).toBe(true);
      expect(entry.name, "no lone surrogate").not.toMatch(LONE_SURROGATE);
      expect(source.startsWith(entry.name.slice(0, -1)), "a prefix of the name").toBe(true);
      expect(entry.name.length, "cut only as far as it must be").toBeGreaterThanOrEqual(MAX_NAME - 2);
    }

    const report = await checkReport(gen);
    expect(report.testIntegrity.changes, "check() reports the same summary").toEqual(s);
  });
});
