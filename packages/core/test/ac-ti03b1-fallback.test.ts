import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside the test body: this AC test is written before the line reader's new
// "adds" sentence, its `pytestmark` reading and the fixtures exist. The first run has no test sources at all; the
// second has them but no Python test index, so only the line reader can speak in either.

const REPO_ROOT = "/home/runner/work/demo/demo";
const JS = "src/cart.test.ts";
const PY = "tests/test_user.py";
const ADDS = "A skip was added to a test that no removed line of this file opens, so the diff shows it as new.";
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

/** check() in mode block with or without the case's test sources, and never with a Python test index. */
async function runCase(c: Case, withSources: boolean): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    ...(withSources
      ? { testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } } }
      : {}),
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

describe("TI03 without the test index: the line reader alone", () => {
  it("AC-10: the renamed it.skip without test sources warns with the new adds sentence, and the module pytestmark without a Python index blocks at its line", async () => {
    const js = loadCase("block-renamed-skip");
    const jsLine = lineStarting(textOf(js.head, JS), 'it.skip("subs2", () => {');
    expect(ti03(await runCase(js, false)), "block-renamed-skip with no test sources").toEqual([
      { severity: "warn", path: JS, line: jsLine, detail: ADDS },
    ]);

    const py = loadCase("block-pytestmark-module");
    const pyHead = textOf(py.head, PY);
    const pyLine = lineStarting(pyHead, "pytestmark = pytest.mark.skip(");
    expect(pyHead.split("\n")[pyLine - 1]?.startsWith("pytestmark"), "the pytestmark line is at column 0").toBe(true);
    expect(textOf(py.base, PY), "no pytestmark at base").not.toContain("pytestmark");
    expect(ti03(await runCase(py, true)), "block-pytestmark-module with no Python index").toEqual([
      { severity: "block", path: PY, line: pyLine, detail: EXISTING },
    ]);
  });
});
