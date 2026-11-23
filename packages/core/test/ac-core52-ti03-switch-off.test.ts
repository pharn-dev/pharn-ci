import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { indexTestFile } from "../src/testIndex/indexTestFile.js";
import type { TestBlock } from "../src/testIndex/types.js";
import type { TestSourceFile as SourceFile } from "../src/testSources.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-52 (R2.3): the TI03 pair pass reads how the JS/TS test index says a test is switched off: a `skip`, `todo` or
// `fails` option, an `if` or an uncalled function around the test, and an empty `.each([])` table. Each case is one
// fixture under fixtures/test-integrity/TI03/; the expected line is read from the fixture text, the expected severity
// and sentence are written here.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const EXISTING =
  "An unconditional skip was added to a test that the diff shows existed before this change, so that test no longer runs.";
const CONDITIONAL = "A conditional skip was added; the test is skipped only where its condition holds.";

interface Case {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

function loadCase(name: string): Case {
  const root = `${FIXTURES}test-integrity/TI03/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

async function runCase(c: Case): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  });
  expectValidReport(report);
  return report;
}

function textOf(files: SourceFile[], path: string): string {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no ${path}`);
  return file.text;
}

/** The 1-based number of the one line of `text` whose trimmed start is `start`. */
function lineStarting(text: string, start: string): number {
  const found = text
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trimStart().startsWith(start));
  expect(found, `exactly one line starts with ${start}`).toHaveLength(1);
  return (found[0] as { index: number }).index + 1;
}

const ti03 = (report: Report) =>
  report.testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map(({ severity, path, line, detail }) => ({ severity, path, line, detail }));

/** The one test block of a side of a case named `name`. */
function testNamed(files: SourceFile[], name: string): TestBlock {
  const result = indexTestFile(PATH, textOf(files, PATH));
  if (!result.parsed) throw new Error(`the fixture was refused: ${result.reason}`);
  const found = result.tests.filter((b) => b.kind === "test" && b.name === name);
  expect(found).toHaveLength(1);
  return found[0] as TestBlock;
}

describe("CORE-52: TI03 sees a test switched off by an option, a guard or an empty table", () => {
  it.each([
    ["block-options-skip-true", "{ skip: true }", 'it("adds the items", { skip: true }, () => {'],
    ["block-options-todo-true", "{ todo: true }", 'it("adds the items", { todo: true }, () => {'],
    ["block-options-fails-true", "{ fails: true }", 'it("adds the items", () => {'],
  ])(
    "%s: an added %s option on an existing test is one block TI03 and fails the verdict",
    async (name, option, start) => {
      const c = loadCase(name);
      const base = textOf(c.base, PATH);
      const head = textOf(c.head, PATH);
      expect(base, "the base has no option").not.toContain(option);
      expect(head, "the head adds the option").toContain(option);
      const report = await runCase(c);
      expect(ti03(report)).toEqual([
        { severity: "block", path: PATH, line: lineStarting(head, start), detail: EXISTING },
      ]);
      expect(report.testIntegrity.verdict).toBe("fail");
    },
  );

  it("block-each-empty-table: it.each(cases) changed to it.each([]) is one block TI03 at the it.each line", async () => {
    const c = loadCase("block-each-empty-table");
    const head = textOf(c.head, PATH);
    expect(textOf(c.base, PATH)).toContain("it.each(cases)(");
    const report = await runCase(c);
    expect(ti03(report)).toEqual([
      { severity: "block", path: PATH, line: lineStarting(head, "it.each([])("), detail: EXISTING },
    ]);
    expect(report.testIntegrity.verdict).toBe("fail");
  });

  it.each([
    ["warn-if-false-guard", "if (false) {", "if"],
    ["warn-uncalled-function", "function unused() {", "uncalled-function"],
  ])(
    "%s: an existing test wrapped in `%s` is one conditional (warn) TI03 at the test's line",
    async (name, wrapper, guarded) => {
      const c = loadCase(name);
      const head = textOf(c.head, PATH);
      expect(textOf(c.base, PATH)).not.toContain(wrapper);
      expect(head).toContain(wrapper);
      expect(testNamed(c.base, "adds the items").guarded).toBeUndefined();
      expect(testNamed(c.head, "adds the items").guarded).toBe(guarded);
      const report = await runCase(c);
      expect(ti03(report)).toEqual([
        { severity: "warn", path: PATH, line: lineStarting(head, 'it("adds the items"'), detail: CONDITIONAL },
      ]);
    },
  );

  it.each([
    ["pass-options-timeout", "{ timeout: 1000 }"],
    ["pass-options-retry", "{ retry: 2 }"],
    ["pass-options-skip-false", "{ skip: false }"],
    ["pass-for-of-loop", "for (const run of [1]) {"],
    ["pass-called-helper", "addsTests();"],
    ["pass-describe-callback", 'describe("cart", () => {'],
  ])("%s: `%s` added around or on an existing test gives no TI03", async (name, form) => {
    const c = loadCase(name);
    expect(textOf(c.base, PATH)).not.toContain(form);
    expect(textOf(c.head, PATH)).toContain(form);
    const head = testNamed(c.head, "adds the items");
    expect(head.guarded).toBeUndefined();
    expect(head.modifiers).toEqual([]);
    const report = await runCase(c);
    expect(ti03(report)).toEqual([]);
  });

  it("pass-if-env-unchanged: a test under `if (process.env.CI)` at base and at head gives no TI03", async () => {
    const c = loadCase("pass-if-env-unchanged");
    expect(testNamed(c.base, "adds the items").guarded).toBe("if");
    expect(testNamed(c.head, "adds the items").guarded).toBe("if");
    const report = await runCase(c);
    expect(ti03(report)).toEqual([]);
  });
});
