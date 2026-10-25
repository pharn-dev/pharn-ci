import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources, check(), the JS/TS test index and the fixture are loaded inside the test body: the AC test
// is written before the tests-changed summary and fixtures/tests-changed/ exist, so nothing that depends on them may
// run while the file loads. The expected entries are the ones the fixture is planned to hold (per file: the tests
// added, removed, modified in body or modifiers under the same name, renamed in the same file, moved to another file,
// and unchanged); their lines are read from the fixture text, through the JS/TS test index for JS/TS and from the
// `def` line for Python. The real interpreter indexes tests/test_e.py, with no skip.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ROOT = `${FIXTURES}tests-changed/`;
const REPO_ROOT = "/home/runner/work/demo/demo";
const SLOW = 60_000;

interface SourceFile {
  path: string;
  text: string;
}
interface Block {
  kind: string;
  path: string[];
  line: number;
}
interface Entry {
  path: string;
  name: string;
  line: number;
}
interface Changes {
  totals: { added: number; removed: number; modified: number; renamed: number };
  files: Array<{
    path: string;
    language: string;
    added: number;
    removed: number;
    modified: number;
    renamed: number;
  }>;
  added: Entry[];
  removed: Entry[];
  modified: Entry[];
  renamed: Entry[];
  truncated?: number;
}
interface Report {
  testIntegrity: { mode: string; changes?: Changes };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

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

const textAt = (files: SourceFile[], path: string) => {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
  return file.text;
};

/** The head (or base) line of a JS/TS test by its full name, through the existing JS/TS test index. */
async function jsLine(files: SourceFile[], path: string, fullName: string): Promise<number> {
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(path, textAt(files, path));
  if (!result.parsed) throw new Error(`${path} does not parse`);
  const found = (result.tests ?? []).filter((b) => b.kind === "test" && b.path.join(" › ") === fullName);
  expect(found, `${path}: one test named ${fullName}`).toHaveLength(1);
  return (found[0] as Block).line;
}

/** The line of a module-level `def <name>(` in a Python test file. */
function pyLine(files: SourceFile[], path: string, name: string): number {
  const lines = textAt(files, path).split("\n");
  const at = lines.findIndex((line) => new RegExp(`^def ${name}\\(`).test(line));
  expect(at, `${path}: def ${name}(`).toBeGreaterThan(-1);
  return at + 1;
}

/** Load the fixture, index its Python sources with node-io, then run check() in mode warn. */
async function runTestsChanged(): Promise<{ report: Report; base: SourceFile[]; head: SourceFile[] }> {
  const base = sideFiles(`${ROOT}base`);
  const head = sideFiles(`${ROOT}head`);
  const diff = readFileSync(`${ROOT}change.diff`, "utf8");
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
  };
  const sources = { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  expect(pythonTestIndex?.available, "the Python index ran with the real interpreter").toBe(true);
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set(head.map((f) => f.path))].sort(),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "warn" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return { report: report as unknown as Report, base, head };
}

const byPathThenLine = (a: Entry, b: Entry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line);

describe("the tests-changed summary: testIntegrity.changes", () => {
  it(
    "AC-8: the multi-file fixture in mode warn gives the totals, the per-file counts of changed files only, and the added, removed, modified and renamed entries at the right path and line, sorted, with full names",
    async () => {
      const diff = readFileSync(`${ROOT}change.diff`, "utf8");
      for (const path of ["src/a.test.ts", "src/b.test.ts", "src/c.test.js", "src/f.test.ts", "tests/test_e.py"]) {
        expect(diff, `${path} is modified in the diff`).toContain(`+++ b/${path}`);
      }
      expect(diff).toMatch(/new file mode \d+\n(?:index \S+\n)?--- \/dev\/null\n\+\+\+ b\/src\/d\.test\.ts/);

      const { report, base, head } = await runTestsChanged();
      const changes = report.testIntegrity.changes;
      expect(changes, "testIntegrity.changes is present").toBeDefined();
      const c = changes as Changes;

      const entry = async (side: SourceFile[], path: string, name: string): Promise<Entry> => ({
        path,
        name,
        line: path.endsWith(".py") ? pyLine(side, path, name) : await jsLine(side, path, name),
      });
      const removed = [await entry(base, "src/a.test.ts", "a › drops")];
      const added = [
        await entry(head, "src/a.test.ts", "a › new one"),
        await entry(head, "src/c.test.js", "c › added here"),
        await entry(head, "src/d.test.ts", "d › fresh"),
        await entry(head, "tests/test_e.py", "test_new"),
      ].sort(byPathThenLine);
      const modified = [
        await entry(head, "src/a.test.ts", "a › edits"),
        await entry(head, "src/a.test.ts", "a › flag"),
        await entry(head, "tests/test_e.py", "test_change"),
      ].sort(byPathThenLine);
      const renamed = [
        await entry(head, "src/b.test.ts", "b › new name"),
        await entry(head, "src/d.test.ts", "d › moves"),
      ].sort(byPathThenLine);

      expect(c.totals).toEqual({ added: 4, removed: 1, modified: 3, renamed: 2 });
      expect(c.files).toEqual([
        { path: "src/a.test.ts", language: "ts", added: 1, removed: 1, modified: 2, renamed: 0 },
        { path: "src/b.test.ts", language: "ts", added: 0, removed: 0, modified: 0, renamed: 1 },
        { path: "src/c.test.js", language: "js", added: 1, removed: 0, modified: 0, renamed: 0 },
        { path: "src/d.test.ts", language: "ts", added: 1, removed: 0, modified: 0, renamed: 1 },
        { path: "tests/test_e.py", language: "py", added: 1, removed: 0, modified: 1, renamed: 0 },
      ]);
      expect(c.removed).toEqual(removed);
      expect(c.added).toEqual(added);
      expect(c.modified).toEqual(modified);
      expect(c.renamed).toEqual(renamed);
      expect("truncated" in c, "no truncated key").toBe(false);

      const listed = [...c.added, ...c.removed, ...c.modified, ...c.renamed].map((e) => e.name);
      for (const unchanged of ["a › keeps", "b › same", "c › stays", "f › one", "test_keep"]) {
        expect(listed, `${unchanged} is in no list`).not.toContain(unchanged);
      }
    },
    SLOW,
  );
});
