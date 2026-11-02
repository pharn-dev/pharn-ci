import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: these AC tests are written before the TI03 pair pass and
// its fixtures exist, so nothing the build adds may run while the file loads. Each test first checks that its fixture
// holds the case its AC describes, and takes the expected head line from the fixture text; the expected severity and
// sentence are written here, never read from the build.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const EXISTING =
  "An unconditional skip was added to a test that the diff shows existed before this change, so that test no longer runs.";

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
  testIntegrity: { signals: Signal[]; verdict: string };
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

const ti03 = (report: Report) =>
  report.testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map(({ severity, path, line, detail }) => ({ severity, path, line, detail }));

describe("TI03 blocks a skip added to an existing test however the JS/TS change writes it", () => {
  it("AC-1: a test renamed to it.skip with the same body gives one block TI03 at the it.skip line with the unconditional-skip sentence, and the verdict fails", async () => {
    const c = loadCase("block-renamed-skip");
    const base = textOf(c.base, PATH);
    const head = textOf(c.head, PATH);
    expect(base.split("\n"), "the base holds the test unskipped").toContain('it("subs", () => {');
    expect(base, "nothing is skipped at base").not.toContain(".skip");
    const line = lineStarting(head, 'it.skip("subs2", () => {');
    expect(c.diff, "the diff removes the old opening line").toContain('\n-it("subs", () => {');
    expect(c.diff, "the diff adds the skipped opening line").toContain('\n+it.skip("subs2", () => {');

    const report = await runCase(c);
    expect(ti03(report)).toEqual([{ severity: "block", path: PATH, line, detail: EXISTING }]);
    expect(report.testIntegrity.verdict).toBe("fail");
  });

  it("AC-2: an added describe.skip wrapped around an unchanged existing test gives one block TI03 at the describe.skip line", async () => {
    const c = loadCase("block-describe-skip-wrapper");
    const base = textOf(c.base, PATH);
    const head = textOf(c.head, PATH);
    expect(base.split("\n"), "the base holds the test at the top level").toContain('it("subs", () => {');
    expect(base, "no describe block at base").not.toMatch(/^\s*describe/m);
    expect(head.split("\n"), "the head holds the same test inside the wrapper").toContain('  it("subs", () => {');
    const line = lineStarting(head, 'describe.skip("quarantine", () => {');
    expect(c.diff).toContain('\n+describe.skip("quarantine", () => {');

    const report = await runCase(c);
    expect(ti03(report)).toEqual([{ severity: "block", path: PATH, line, detail: EXISTING }]);
  });

  it("AC-3: an existing test cut and pasted into an unchanged describe.skip block gives one block TI03 at the moved test's line", async () => {
    const c = loadCase("block-moved-into-skipped-describe");
    const base = textOf(c.base, PATH);
    const head = textOf(c.head, PATH);
    expect(base.split("\n"), "the skipped block exists at base").toContain('describe.skip("legacy", () => {');
    expect(head.split("\n"), "and at head").toContain('describe.skip("legacy", () => {');
    expect(base.split("\n"), "the test is top-level at base").toContain('it("subs", () => {');
    expect(head.split("\n"), "and inside the skipped block at head").toContain('  it("subs", () => {');
    const changed = c.diff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
    expect(
      changed.some((l) => l.includes("describe")),
      "the diff does not touch the describe line",
    ).toBe(false);
    const line = lineStarting(head, 'it("subs", () => {');

    const report = await runCase(c);
    expect(ti03(report)).toEqual([{ severity: "block", path: PATH, line, detail: EXISTING }]);
  });

  it("AC-4: a test renamed to it.skipIf(true) with the same body gives one block TI03 at that line", async () => {
    const c = loadCase("block-renamed-skipif-true");
    const base = textOf(c.base, PATH);
    const head = textOf(c.head, PATH);
    expect(base.split("\n"), "the base holds the test unskipped").toContain('it("totals", () => {');
    expect(base, "nothing is skipped at base").not.toContain("skip");
    const line = lineStarting(head, 'it.skipIf(true)("totals2", () => {');
    expect(c.diff).toContain('\n+it.skipIf(true)("totals2", () => {');

    const report = await runCase(c);
    expect(ti03(report)).toEqual([{ severity: "block", path: PATH, line, detail: EXISTING }]);
  });
});
