import { spawnSync } from "node:child_process";
import type { PythonIndexRun } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import type { TestBlock as Block } from "../../core/src/testIndex/types.js";

// CORE-53 (R2.4): what the Python test index records for the ways a test is switched off, read with the real python3.
// The index script is loaded inside each test body. With no python3 of 3.8 or newer on PATH the tests fail with that
// reason, never skip.

const SLOW = 60_000;

const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

/** Fails the test, with the reason, when no python3 of 3.8 or newer is on PATH. */
function requirePython(): void {
  if (!PYTHON.ok) {
    throw new Error(
      `this test needs python3 3.8 or newer on PATH and found ${PYTHON.version === "" ? `none (${PYTHON.error || "python3 did not run"})` : `python3 ${PYTHON.version}`}`,
    );
  }
}

/** The blocks of one Python test file, indexed with the real python3. */
async function blocksOf(text: string): Promise<Block[]> {
  const io = await import("../src/index.js");
  const run = await io.indexPythonTests([{ path: "tests/test_forms.py", text }]);
  expect(run.available, "the Python index ran").toBe(true);
  const result = (run as Extract<PythonIndexRun, { available: true }>).files[0]?.result;
  expect(result?.parsed, "the file parsed").toBe(true);
  return (result as { tests: Block[] }).tests;
}

/** The fields CORE-53 adds, by the block's full path, only where a block has one. */
function fieldsOf(blocks: Block[]) {
  return blocks.map((b) => {
    const out: Record<string, unknown> = { path: b.path.join("::"), modifiers: b.modifiers };
    if (b.guarded !== undefined) out.guarded = b.guarded;
    if (b.emptyTable !== undefined) out.emptyTable = b.emptyTable;
    if (b.removedAt !== undefined) out.removedAt = b.removedAt;
    if (b.moduleSkip !== undefined) out.moduleSkip = b.moduleSkip;
    return out;
  });
}

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

describe("CORE-53: the Python index reads the forms that switch a test off", () => {
  it(
    'a test def or test class under an `if` (either branch) carries guarded: "if"; under while, try or with it does not',
    async () => {
      requirePython();
      const blocks = await blocksOf(
        lines(
          "import sys",
          "if sys.platform == 'win32':",
          "    def test_a():",
          "        assert 1",
          "else:",
          "    def test_b():",
          "        assert 1",
          "if sys.version_info < (3, 9):",
          "    class TestC:",
          "        def test_d(self):",
          "            assert 1",
          "while False:",
          "    def test_e():",
          "        assert 1",
          "try:",
          "    def test_f():",
          "        assert 1",
          "except ImportError:",
          "    pass",
          "def test_g():",
          "    if sys:",
          "        assert 1",
        ),
      );
      expect(fieldsOf(blocks)).toEqual([
        { path: "test_a", modifiers: [], guarded: "if" },
        { path: "test_b", modifiers: [], guarded: "if" },
        { path: "TestC", modifiers: [], guarded: "if" },
        { path: "TestC::test_d", modifiers: [] },
        { path: "test_e", modifiers: [] },
        { path: "test_f", modifiers: [] },
        { path: "test_g", modifiers: [] },
      ]);
    },
    SLOW,
  );

  it(
    "of two sibling defs or classes with one name the earlier is a skip removed at the later; different names or other branches are not",
    async () => {
      requirePython();
      const blocks = await blocksOf(
        lines(
          "import sys",
          "def test_a():",
          "    assert 1",
          "def test_a():",
          "    assert 2",
          "def test_b():",
          "    assert 1",
          "class TestC:",
          "    def test_d(self):",
          "        assert 1",
          "    async def test_d(self):",
          "        assert 2",
          "if sys:",
          "    def test_e():",
          "        assert 1",
          "else:",
          "    def test_e():",
          "        assert 2",
        ),
      );
      expect(fieldsOf(blocks)).toEqual([
        { path: "test_a", modifiers: ["skip"], removedAt: 4 },
        { path: "test_a", modifiers: [] },
        { path: "test_b", modifiers: [] },
        { path: "TestC", modifiers: [] },
        { path: "TestC::test_d", modifiers: ["skip"], removedAt: 11 },
        { path: "TestC::test_d", modifiers: [] },
        { path: "test_e", modifiers: [], guarded: "if" },
        { path: "test_e", modifiers: [], guarded: "if" },
      ]);
    },
    SLOW,
  );

  it(
    "`del test_x`, `del a, b`, `test_x.__test__ = False`, `TestX.__test__ = False` and a class-body `__test__ = False` are a skip; `__test__ = True` is not",
    async () => {
      requirePython();
      const blocks = await blocksOf(
        lines(
          "def test_a():",
          "    assert 1",
          "def test_b():",
          "    assert 1",
          "def test_c():",
          "    assert 1",
          "def test_d():",
          "    assert 1",
          "class TestE:",
          "    def test_f(self):",
          "        assert 1",
          "class TestG:",
          "    __test__ = False",
          "    def test_h(self):",
          "        assert 1",
          "def test_i():",
          "    assert 1",
          "del test_a",
          "del test_b, test_c",
          "test_d.__test__ = False",
          "TestE.__test__ = False",
          "test_i.__test__ = True",
        ),
      );
      expect(fieldsOf(blocks)).toEqual([
        { path: "test_a", modifiers: ["skip"], removedAt: 18 },
        { path: "test_b", modifiers: ["skip"], removedAt: 19 },
        { path: "test_c", modifiers: ["skip"], removedAt: 19 },
        { path: "test_d", modifiers: ["skip"], removedAt: 20 },
        { path: "TestE", modifiers: ["skip"], removedAt: 21 },
        { path: "TestE::test_f", modifiers: [] },
        { path: "TestG", modifiers: ["skip"], removedAt: 13 },
        { path: "TestG::test_h", modifiers: [] },
        { path: "test_i", modifiers: [] },
      ]);
    },
    SLOW,
  );

  it(
    "parametrize with an empty list or tuple, positional or argvalues=, carries emptyTable: true; a non-empty one does not",
    async () => {
      requirePython();
      const blocks = await blocksOf(
        lines(
          "import pytest",
          "from pytest import mark",
          "@pytest.mark.parametrize('c', [])",
          "def test_a(c):",
          "    assert c",
          "@mark.parametrize('c', ())",
          "def test_b(c):",
          "    assert c",
          "@pytest.mark.parametrize(argnames='c', argvalues=[])",
          "def test_c(c):",
          "    assert c",
          "@pytest.mark.parametrize('c', [1])",
          "def test_d(c):",
          "    assert c",
          "@pytest.mark.parametrize('c', [1])",
          "@pytest.mark.parametrize('d', [])",
          "class TestE:",
          "    def test_f(self, c, d):",
          "        assert c",
        ),
      );
      expect(fieldsOf(blocks)).toEqual([
        { path: "test_a", modifiers: ["each"], emptyTable: true },
        { path: "test_b", modifiers: ["each"], emptyTable: true },
        { path: "test_c", modifiers: ["each"], emptyTable: true },
        { path: "test_d", modifiers: ["each"] },
        { path: "TestE", modifiers: ["each"], emptyTable: true },
        { path: "TestE::test_f", modifiers: [] },
      ]);
    },
    SLOW,
  );

  it(
    "a module-level importorskip or pytest.skip(..., allow_module_level=True) puts moduleSkip (its line) on every block",
    async () => {
      requirePython();
      const skipped = await blocksOf(
        lines(
          "import sys",
          "import pytest",
          "def test_a():",
          "    assert 1",
          "if sys.platform == 'win32':",
          "    pytest.skip('posix only', allow_module_level=True)",
          "np = pytest.importorskip('numpy')",
          "class TestB:",
          "    def test_c(self):",
          "        assert 1",
        ),
      );
      expect(fieldsOf(skipped)).toEqual([
        { path: "test_a", modifiers: [], moduleSkip: 6 },
        { path: "TestB", modifiers: [], moduleSkip: 6 },
        { path: "TestB::test_c", modifiers: [], moduleSkip: 6 },
      ]);
    },
    SLOW,
  );

  it(
    "a skip without allow_module_level, one with it false, and an importorskip inside a function or a test are no module skip",
    async () => {
      requirePython();
      const blocks = await blocksOf(
        lines(
          "import pytest",
          "def helper():",
          "    return pytest.importorskip('numpy')",
          "pytest.skip('x', allow_module_level=False)",
          "def test_a():",
          "    np = pytest.importorskip('numpy')",
          "    assert np",
        ),
      );
      expect(fieldsOf(blocks)).toEqual([{ path: "test_a", modifiers: [] }]);
    },
    SLOW,
  );

  it(
    "`raise unittest.SkipTest(...)` in a test body is a skip (skipIf under a condition), as written or through an import alias",
    async () => {
      requirePython();
      const blocks = await blocksOf(
        lines(
          "import unittest",
          "from unittest import SkipTest",
          "def test_a():",
          "    raise unittest.SkipTest('broken')",
          "def test_b():",
          "    if True:",
          "        raise SkipTest('maybe')",
          "def test_c():",
          "    raise SkipTest",
          "def test_d():",
          "    raise ValueError('x')",
          "def test_e():",
          "    def inner():",
          "        raise SkipTest('nested')",
          "    assert inner",
        ),
      );
      expect(fieldsOf(blocks)).toEqual([
        { path: "test_a", modifiers: ["skip"] },
        { path: "test_b", modifiers: ["skipIf"] },
        { path: "test_c", modifiers: ["skip"] },
        { path: "test_d", modifiers: [] },
        { path: "test_e", modifiers: [] },
      ]);
    },
    SLOW,
  );
});

describe("CORE-53: names are cut, and the script stays Python 3.8", () => {
  it(
    "a class with a 40,000-character name gives an index whose name and path entries are cut to 500 characters",
    async () => {
      requirePython();
      const { PYTHON_BOOTSTRAP, PYTHON_INDEX_SCRIPT } = await import("../src/pythonIndexScript.js");
      const long = `Test${"x".repeat(39_996)}`;
      expect(long).toHaveLength(40_000);
      const text = lines(
        `class ${long}:`,
        ...Array.from({ length: 50 }, (_, i) => `    def test_${i}(self):\n        assert 1`),
      );
      const run = spawnSync("python3", ["-I", "-S", "-B", "-c", PYTHON_BOOTSTRAP, PYTHON_INDEX_SCRIPT], {
        input: JSON.stringify([{ id: 0, text }]),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
      });
      expect(run.status, run.stderr).toBe(0);
      const [entry] = JSON.parse(run.stdout) as { tests: { name: string; path: string[] }[] }[];
      const tests = entry?.tests ?? [];
      expect(tests).toHaveLength(51);
      const group = tests[0] as { name: string; path: string[] };
      expect(group.name).toBe(long.slice(0, 500));
      expect(group.path).toEqual([long.slice(0, 500)]);
      for (const test of tests.slice(1)) expect(test.path[0]).toBe(long.slice(0, 500));
      // The normalized text holds the file once; no block repeats the full name.
      expect(run.stdout.length, "the output no longer carries the full name per test").toBeLessThan(
        text.length + 51 * 1_200,
      );
      const blocks = await blocksOf(text);
      expect(blocks[0]?.name).toHaveLength(500);
    },
    SLOW,
  );

  it(
    "the index script parses with ast.parse(feature_version=(3, 8)) and holds no backslash or backtick",
    async () => {
      requirePython();
      const { PYTHON_INDEX_SCRIPT } = await import("../src/pythonIndexScript.js");
      expect(PYTHON_INDEX_SCRIPT.includes("\\")).toBe(false);
      expect(PYTHON_INDEX_SCRIPT.includes("`")).toBe(false);
      const run = spawnSync(
        "python3",
        ["-I", "-c", "import ast, sys; ast.parse(sys.stdin.read(), feature_version=(3, 8)); print('ok')"],
        { input: PYTHON_INDEX_SCRIPT, encoding: "utf8", timeout: 30_000 },
      );
      expect(run.stderr).toBe("");
      expect(run.stdout.trim()).toBe("ok");
    },
    SLOW,
  );
});
