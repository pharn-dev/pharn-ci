import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-53 (R2.4): the Python test index reads how a test is switched off. Each case under
// fixtures/test-integrity/python-switch-off/ is indexed by node-io with the real python3, then check() runs; the TI03
// signals are compared with the expectation written here. Each fixture is first checked against its own diff (every
// added line is in head at its line, every removed line in base at its line). With no python3 of 3.8 or newer on PATH
// the tests fail with that reason, never skip.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const PY = "tests/test_user.py";
const EXISTING =
  "An unconditional skip was added to a test that the diff shows existed before this change, so that test no longer runs.";
const CONDITIONAL = "A conditional skip was added; the test is skipped only where its condition holds.";
const MODULE =
  "A module-level skip was added (pytest.importorskip, or pytest.skip with allow_module_level=True); every test of the file is skipped wherever it takes effect.";
const SLOW = 120_000;

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

interface SourceFile {
  path: string;
  text: string;
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}

function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Every `-` line of the diff is in base at its old line, every `+` line in head at its new line. */
function expectDiffMatches(diff: string, base: string, head: string): void {
  const baseLines = base.split("\n");
  const headLines = head.split("\n");
  let oldLine = 0;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk !== null) {
      oldLine = Number(hunk[1]) + (hunk[2] === "0" ? 1 : 0);
      newLine = Number(hunk[3]) + (hunk[4] === "0" ? 1 : 0);
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-")) expect(baseLines[oldLine++ - 1], `base line ${oldLine - 1}`).toBe(line.slice(1));
    else if (line.startsWith("+")) expect(headLines[newLine++ - 1], `head line ${newLine - 1}`).toBe(line.slice(1));
  }
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

async function runCase(name: string, mode: "block" | "warn" = "block") {
  const root = `${FIXTURES}test-integrity/python-switch-off/${name}/`;
  const diff = readFileSync(`${root}change.diff`, "utf8");
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  const baseText = base.find((f) => f.path === PY)?.text ?? "";
  const headText = head.find((f) => f.path === PY)?.text ?? "";
  expectDiffMatches(diff, baseText, headText);
  const testSources = { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
  };
  const pythonTestIndex = await io.indexPythonTestSources(testSources);
  expect(pythonTestIndex?.available, `${name}: the Python index ran`).toBe(true);
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [PY, "src/cart.ts"].sort(),
    testSources,
    pythonTestIndex,
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  const ti03 = (report as unknown as { testIntegrity: { signals: Signal[] } }).testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map(({ severity, path, line, detail }) => ({ severity, path, line, detail }));
  return { baseText, headText, ti03 };
}

describe("CORE-53: a switch-off form the PR adds to an existing Python test is a TI03 finding", () => {
  it(
    "a test def the PR puts under an `if` gives one warn TI03 (a conditional skip) at the def line",
    async () => {
      requirePython();
      const { baseText, headText, ti03 } = await runCase("warn-if-guard");
      expect(baseText).not.toContain("if ");
      const line = lineStarting(headText, "def test_full_name():");
      expect(headText.split("\n")[line - 2]).toBe('if sys.platform != "win32":');
      expect(ti03).toEqual([{ severity: "warn", path: PY, line, detail: CONDITIONAL }]);
    },
    SLOW,
  );

  it(
    "a later def with the same name gives one block TI03 at the later def (the earlier test is never collected)",
    async () => {
      requirePython();
      const { baseText, headText, ti03 } = await runCase("block-duplicate-def");
      expect(baseText.match(/def test_full_name\(/g)).toHaveLength(1);
      const lines = headText.split("\n").flatMap((text, i) => (text === "def test_full_name():" ? [i + 1] : []));
      expect(lines).toHaveLength(2);
      expect(ti03).toEqual([{ severity: "block", path: PY, line: lines[1], detail: EXISTING }]);
    },
    SLOW,
  );

  it(
    "`del test_x` gives one block TI03 at the del line",
    async () => {
      requirePython();
      const { headText, ti03 } = await runCase("block-del-test");
      const line = lineStarting(headText, "del test_full_name");
      expect(ti03).toEqual([{ severity: "block", path: PY, line, detail: EXISTING }]);
    },
    SLOW,
  );

  it(
    "`test_x.__test__ = False` gives one block TI03 at that line, and warn in mode warn",
    async () => {
      requirePython();
      const { headText, ti03 } = await runCase("block-test-attr-false");
      const line = lineStarting(headText, "test_full_name.__test__ = False");
      expect(ti03).toEqual([{ severity: "block", path: PY, line, detail: EXISTING }]);
      const warned = await runCase("block-test-attr-false", "warn");
      expect(warned.ti03).toEqual([{ severity: "warn", path: PY, line, detail: EXISTING }]);
    },
    SLOW,
  );

  it(
    '`@pytest.mark.parametrize("first", [])` gives one block TI03 at the def line',
    async () => {
      requirePython();
      const { headText, ti03 } = await runCase("block-parametrize-empty");
      const line = lineStarting(headText, "def test_full_name(first):");
      expect(headText.split("\n")[line - 2]).toBe('@pytest.mark.parametrize("first", [])');
      expect(ti03).toEqual([{ severity: "block", path: PY, line, detail: EXISTING }]);
    },
    SLOW,
  );

  it(
    "a module-level `pytest.importorskip(...)` gives one warn TI03 at its line, in mode block",
    async () => {
      requirePython();
      const { headText, ti03 } = await runCase("warn-importorskip");
      const line = lineStarting(headText, 'np = pytest.importorskip("numpy")');
      expect(ti03).toEqual([{ severity: "warn", path: PY, line, detail: MODULE }]);
    },
    SLOW,
  );

  it(
    "a module-level `pytest.skip(..., allow_module_level=True)` gives one warn TI03 at its line, in mode block",
    async () => {
      requirePython();
      const { headText, ti03 } = await runCase("warn-skip-module-level");
      const line = lineStarting(headText, 'pytest.skip("posix only", allow_module_level=True)');
      expect(ti03).toEqual([{ severity: "warn", path: PY, line, detail: MODULE }]);
    },
    SLOW,
  );

  it(
    "`raise unittest.SkipTest(...)` in the body of an existing test gives one block TI03 at the raise line",
    async () => {
      requirePython();
      const { headText, ti03 } = await runCase("block-raise-skiptest");
      const line = lineStarting(headText, 'raise unittest.SkipTest("broken")');
      expect(ti03).toEqual([{ severity: "block", path: PY, line, detail: EXISTING }]);
    },
    SLOW,
  );
});

describe("CORE-53: what is already there at base, or is not a switch-off, gives no TI03", () => {
  it(
    'an `if sys.platform == "win32":` around a test unchanged at base and head gives none',
    async () => {
      requirePython();
      const { baseText, headText, ti03 } = await runCase("pass-if-guard-unchanged");
      expect(baseText).toContain('if sys.platform == "win32":\n    def test_full_name():');
      expect(headText).toContain('if sys.platform == "win32":\n    def test_full_name():');
      expect(ti03).toEqual([]);
    },
    SLOW,
  );

  it(
    "a module-level importorskip already at base gives none",
    async () => {
      requirePython();
      const { baseText, ti03 } = await runCase("pass-importorskip-at-base");
      expect(baseText).toContain('np = pytest.importorskip("numpy")');
      expect(ti03).toEqual([]);
    },
    SLOW,
  );

  it(
    "parametrize with a non-empty list gives none",
    async () => {
      requirePython();
      const { headText, ti03 } = await runCase("pass-parametrize-non-empty");
      expect(headText).toContain('@pytest.mark.parametrize("first", ["ada", "grace"])');
      expect(ti03).toEqual([]);
    },
    SLOW,
  );

  it(
    "two defs with different names give none",
    async () => {
      requirePython();
      const { headText, ti03 } = await runCase("pass-two-names");
      expect(headText).toContain("def test_full_name_spaces():");
      expect(ti03).toEqual([]);
    },
    SLOW,
  );
});
