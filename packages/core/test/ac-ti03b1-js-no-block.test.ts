import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside the test body: this AC test is written before the TI03 pair pass, its new
// "adds" sentence and its fixtures exist. Each fixture is first checked for the case it stands for; the expected
// severities and sentences are written here.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const ADDS = "A skip was added to a test that no removed line of this file opens, so the diff shows it as new.";
const CONDITIONAL = "A conditional skip was added; the test is skipped only where its condition holds.";

interface SourceFile {
  path: string;
  text: string;
}
interface Case {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
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
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
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

/** The added and removed lines of a diff, headers left out. */
const changedLines = (diff: string) => diff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));

const ti03 = (report: Report) =>
  report.testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map(({ severity, path, line, detail }) => ({ severity, path, line, detail }));

describe("TI03 does not block the JS/TS skips that stop no test that ran before", () => {
  it("AC-8: a new describe.skip of new tests and a renamed already-skipped test warn with the new adds sentence, a test moved between skipped describes gives nothing, and a renamed test with a non-constant skipIf warns as conditional", async () => {
    const drafts = loadCase("warn-describe-skip-new-tests");
    expect(textOf(drafts.base, PATH), "the drafts block and its tests are new").not.toContain("drafts");
    const draftsLine = lineStarting(textOf(drafts.head, PATH), 'describe.skip("drafts", () => {');
    expect(ti03(await runCase(drafts)), "warn-describe-skip-new-tests").toEqual([
      { severity: "warn", path: PATH, line: draftsLine, detail: ADDS },
    ]);

    const moved = loadCase("pass-moved-between-skipped-describes");
    for (const side of [moved.base, moved.head]) {
      const lines = textOf(side, PATH).split("\n");
      expect(lines, "both skipped blocks on both sides").toContain('describe.skip("legacy", () => {');
      expect(lines, "both skipped blocks on both sides").toContain('describe.skip("parked", () => {');
      expect(lines, "the moved test on both sides").toContain('  it("subs", () => {');
    }
    expect(
      changedLines(moved.diff).some((l) => l.includes("skip")),
      "the diff adds or removes no skip",
    ).toBe(false);
    expect(ti03(await runCase(moved)), "pass-moved-between-skipped-describes").toEqual([]);

    const skipped = loadCase("warn-renamed-already-skipped");
    expect(textOf(skipped.base, PATH).split("\n"), "skipped at base already").toContain('it.skip("a", () => {');
    const skippedLine = lineStarting(textOf(skipped.head, PATH), 'it.skip("b", () => {');
    expect(ti03(await runCase(skipped)), "warn-renamed-already-skipped").toEqual([
      { severity: "warn", path: PATH, line: skippedLine, detail: ADDS },
    ]);

    const condition = loadCase("warn-renamed-skipif-condition");
    expect(textOf(condition.base, PATH).split("\n"), "unskipped at base").toContain('it("totals", () => {');
    const conditionLine = lineStarting(textOf(condition.head, PATH), 'it.skipIf(isCI)("totals2", () => {');
    expect(ti03(await runCase(condition)), "warn-renamed-skipif-condition").toEqual([
      { severity: "warn", path: PATH, line: conditionLine, detail: CONDITIONAL },
    ]);
  });
});
