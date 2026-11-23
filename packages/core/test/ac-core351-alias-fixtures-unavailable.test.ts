import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PythonTestIndex } from "../src/testIndex/pythonSides.js";
import type { TestSourceFile as SourceFile } from "../src/testSources.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-9). check() is loaded inside the test body: the AC test is written before the build, so nothing the
// build changes may run while the file loads. Every TI03 alias case under fixtures/test-integrity/TI03/ (the
// directories whose name holds `-alias-`: the pytest and unittest alias forms the ac-pyparity2-ti03-* tests cover, and
// their literal twins) modifies a `.py` test file whose base and head text are in the sources. Whatever TI03's line
// pass decides on it, a Python index that did not run, or one that refused the head as syntax-error, leaves the file
// not compared, which fails the run in mode block.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI03 = `${FIXTURES}test-integrity/TI03/`;

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

const ALIAS_CASES = readdirSync(TI03)
  .filter((name) => name.includes("-alias-") && statSync(join(TI03, name)).isDirectory())
  .sort();

/** A `.py` test file by its basename (`test_*.py` or `*_test.py`). */
const isPyTest = (path: string) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(path);

const RUN_LEVEL = [
  "python-not-found",
  "python-too-old",
  "python-failed",
  "timeout",
  "output-too-large",
  "bad-output",
] as const;

/** An index that ran, read every base `.py` test file and refused every head one as syntax-error. */
function headRefused(base: SourceFile[], head: SourceFile[]): PythonTestIndex {
  return {
    available: true,
    base: base
      .filter((f) => isPyTest(f.path))
      .map((f) => ({ path: f.path, result: { parsed: true, syntaxErrors: 0, tests: [], mocks: [] } })),
    head: head
      .filter((f) => isPyTest(f.path))
      .map((f) => ({ path: f.path, result: { parsed: false, reason: "syntax-error" } })),
  };
}

describe("CORE-351: the TI03 alias fixtures fail in mode block when the Python index did not read the file", () => {
  it("AC-9: every TI03 alias case, with the Python index unavailable for each run-level reason or refusing the head as syntax-error, gives the verdict fail in mode block", async () => {
    expect(ALIAS_CASES.length, "the alias cases exist").toBeGreaterThanOrEqual(20);
    expect(ALIAS_CASES, "the case AC-9 names is among them").toContain("block-pytest-alias-pt-skip");
    const { check } = await import("./text-coverage.js");

    const actual: Record<string, string> = {};
    const expected: Record<string, string> = {};
    const actualErrors: Record<string, boolean> = {};
    const expectedErrors: Record<string, boolean> = {};
    for (const name of ALIAS_CASES) {
      const root = `${TI03}${name}/`;
      const diff = readFileSync(`${root}change.diff`, "utf8");
      const base = sideFiles(`${root}base`);
      const head = sideFiles(`${root}head`);
      expect(
        head.some((f) => isPyTest(f.path)),
        `${name}: the head text of a .py test file is in the sources`,
      ).toBe(true);
      const indexes: [string, PythonTestIndex][] = [
        ...RUN_LEVEL.map((reason): [string, PythonTestIndex] => [reason, { available: false, reason }]),
        ["head refused as syntax-error", headRefused(base, head)],
      ];
      for (const [label, pythonTestIndex] of indexes) {
        const report = check({
          version: "0.1.0",
          coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
          diff: { text: diff },
          repoRoot: REPO_ROOT,
          threshold: null,
          repoFiles: [...new Set([...head.map((f) => f.path), "src/app.ts", "src/cart.ts"])].sort(),
          testIntegrityMode: { input: "block" },
          testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
          pythonTestIndex,
        });
        expectValidReport(report);
        actual[`${name} / ${label}`] = report.verdict;
        expected[`${name} / ${label}`] = "fail";
        // The verdict alone cannot tell a TI03 block from the index error, so the error itself is checked too: at
        // level error, naming a .py test file (python-not-found with a modified file is the whole-run form instead).
        const errors = report.messages.filter(
          (m) => m.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE" && m.level === "error",
        );
        const named =
          errors.length === 1 &&
          (label === "python-not-found"
            ? (errors[0]?.text.includes("did not run") ?? false) ||
              head.some((f) => isPyTest(f.path) && (errors[0]?.text.includes(f.path) ?? false))
            : head.some((f) => isPyTest(f.path) && (errors[0]?.text.includes(f.path) ?? false)));
        actualErrors[`${name} / ${label}`] = named;
        expectedErrors[`${name} / ${label}`] = true;
      }
    }
    expect(actual).toEqual(expected);
    expect(actualErrors).toEqual(expectedErrors);
  }, 60_000);
});
