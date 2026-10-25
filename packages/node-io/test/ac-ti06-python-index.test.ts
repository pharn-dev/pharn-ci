import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources and check() are loaded inside each test body: the AC tests are written before TI06 and its
// fixtures exist, so nothing the build adds may run while the file loads. The fixtures are written by the build, so
// each test first checks that its fixture text holds the case the AC describes. The real interpreter runs; with no
// python3 of 3.9 or newer on PATH every test fails with that reason, and none is skipped.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "tests/test_cart.py";
const SLOW = 60_000;
const TAUTOLOGY = "an assertion that compares a literal with itself was added";

/** The python3 on PATH and whether it is 3.9 or newer, decided once while the file loads (no build code runs). */
const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 9), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

/** Fails the test, with the reason, when no python3 of 3.9 or newer is on PATH. */
function requirePython(): void {
  if (!PYTHON.ok) {
    throw new Error(
      `this test needs python3 3.9 or newer on PATH and found ${PYTHON.version === "" ? `none (${PYTHON.error || "python3 did not run"})` : `python3 ${PYTHON.version}`}`,
    );
  }
}

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
  testIntegrity: { signals: Signal[]; languages: string[] };
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
  const root = `${FIXTURES}test-integrity/TI06/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

const textAt = (files: SourceFile[], path: string) => {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
  return file.text;
};
const occurrences = (text: string, part: string) => text.split(part).length - 1;
/** How many lines of `text` are exactly `line` once trimmed. */
const linesEqual = (text: string, line: string) => text.split("\n").filter((l) => l.trim() === line).length;

/** Index the case's Python sources with node-io, then run check() on them in mode block. */
async function runPython(c: Case): Promise<Report> {
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
  };
  const sources = { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } };
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  expect(pythonTestIndex?.available, "the Python index ran").toBe(true);

  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set(c.head.map((f) => f.path))].sort(),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  const typed = report as unknown as Report;
  expect(typed.testIntegrity.languages, "the Python file was compared").toEqual(["py"]);
  return typed;
}

/** The case modifies tests/test_cart.py; its base text holds `from` and its head text holds `to` and not `from`. */
function expectChange(c: Case, from: string, to: string): void {
  expect(c.diff).toContain(`--- a/${PATH}`);
  expect(c.diff).toContain(`+++ b/${PATH}`);
  const base = textAt(c.base, PATH);
  const head = textAt(c.head, PATH);
  expect(occurrences(base, from), `base holds ${from}`).toBe(1);
  expect(occurrences(head, from), `head no longer holds ${from}`).toBe(0);
  expect(occurrences(head, to), `head holds ${to}`).toBe(1);
}

const ti06Of = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");

describe("TI06 on Python test files, through the Python test index", () => {
  it(
    "AC-6: assert total([2, 3]) == 5 becoming assert total([2, 3]) gives one warn TI06 whose detail holds assert == → assert truthy",
    async () => {
      requirePython();
      const c = loadCase("warn-py-assert-truthy");
      expectChange(c, "assert total([2, 3]) == 5", "assert total([2, 3])");
      expect(linesEqual(textAt(c.head, PATH), "assert total([2, 3])"), "a bare assert line at head").toBe(1);
      const ti06 = ti06Of(await runPython(c));
      expect(ti06).toHaveLength(1);
      expect(ti06[0]?.severity).toBe("warn");
      expect(ti06[0]?.path).toBe(PATH);
      expect(ti06[0]?.detail).toContain("assert == → assert truthy");
    },
    SLOW,
  );

  it(
    "AC-6: self.assertEqual(total([2, 3]), 5) becoming self.assertTrue(total([2, 3])) gives one warn TI06 whose detail holds assertEqual → assertTrue",
    async () => {
      requirePython();
      const c = loadCase("warn-py-assert-true");
      expectChange(c, "self.assertEqual(total([2, 3]), 5)", "self.assertTrue(total([2, 3]))");
      const ti06 = ti06Of(await runPython(c));
      expect(ti06).toHaveLength(1);
      expect(ti06[0]?.severity).toBe("warn");
      expect(ti06[0]?.path).toBe(PATH);
      expect(ti06[0]?.detail).toContain("assertEqual → assertTrue");
    },
    SLOW,
  );

  it(
    `AC-6: assert True added to a test gives one warn TI06 whose detail holds "${TAUTOLOGY}"`,
    async () => {
      requirePython();
      const c = loadCase("warn-py-tautology");
      expect(c.diff).toContain(`--- a/${PATH}`);
      const base = textAt(c.base, PATH);
      const head = textAt(c.head, PATH);
      expect(linesEqual(head, "assert True") - linesEqual(base, "assert True"), "one assert True added").toBe(1);
      const ti06 = ti06Of(await runPython(c));
      expect(ti06).toHaveLength(1);
      expect(ti06[0]?.severity).toBe("warn");
      expect(ti06[0]?.path).toBe(PATH);
      expect(ti06[0]?.detail).toContain(TAUTOLOGY);
    },
    SLOW,
  );

  it(
    "AC-6: self.assertEqual(a, b) becoming assert a == b gives no TI06",
    async () => {
      requirePython();
      const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
      expect(typeof core.detectTI06, "TI06 exists, so its absence here is the case's doing").toBe("function");
      const c = loadCase("pass-py-equal-to-assert");
      expectChange(c, "self.assertEqual(a, b)", "assert a == b");
      expect(ti06Of(await runPython(c))).toEqual([]);
    },
    SLOW,
  );
});
