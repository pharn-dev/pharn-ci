import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// The fixtures, indexPythonTestSources and check() are loaded inside each test body: these AC tests are written before
// the Python index reads `pytestmark`, the TI03 pair pass and the fixtures exist. Each case's sources are indexed by
// node-io with the real python3, then check() runs in mode block. Each fixture is first checked for the case its AC
// describes; the expected severity and sentence are written here. With no python3 of 3.8 or newer on PATH the tests
// fail with that reason, never skip.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const PY = "tests/test_user.py";
const EXISTING =
  "An unconditional skip was added to a test that the diff shows existed before this change, so that test no longer runs.";
const SLOW = 120_000;

/** The python3 on PATH and whether it is 3.8 or newer, decided once while the file loads (no build code runs). */
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

/** The case's sources indexed with the real python3, then check() in mode block; the report validated. */
async function runCase(name: string) {
  const root = `${FIXTURES}test-integrity/TI03/${name}/`;
  const diff = readFileSync(`${root}change.diff`, "utf8");
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
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
    repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  const ti03 = (report as unknown as Report).testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map(({ severity, path, line, detail }) => ({ severity, path, line, detail }));
  return { diff, base, head, ti03 };
}

/** The two existing tests of the fixtures' base file, unskipped. */
function expectTwoUnskippedTests(base: string): void {
  expect(base, "no pytestmark at base").not.toContain("pytestmark");
  expect(base, "no skip at base").not.toContain("skip");
  expect(base.match(/def test_/g) ?? [], "two tests at base").toHaveLength(2);
}

describe("TI03 blocks a Python skip added to an existing test through pytestmark or in the body", () => {
  it(
    "AC-5: a column-0 pytestmark = pytest.mark.skip(…) added to an existing test file gives one block TI03 at the pytestmark line",
    async () => {
      requirePython();
      const { diff, base, head, ti03 } = await runCase("block-pytestmark-module");
      expectTwoUnskippedTests(textOf(base, PY));
      const headText = textOf(head, PY);
      const line = lineStarting(headText, 'pytestmark = pytest.mark.skip(reason="flaky")');
      expect(headText.split("\n")[line - 1]?.startsWith("pytestmark"), "at column 0").toBe(true);
      expect(diff).toContain('\n+pytestmark = pytest.mark.skip(reason="flaky")');
      expect(ti03).toEqual([{ severity: "block", path: PY, line, detail: EXISTING }]);
    },
    SLOW,
  );

  it(
    "AC-6: a pytestmark = pytest.mark.skip(…) added directly in the body of an existing test class gives one block TI03 at that line",
    async () => {
      requirePython();
      const { base, head, ti03 } = await runCase("block-pytestmark-class");
      const baseText = textOf(base, PY);
      expectTwoUnskippedTests(baseText);
      expect(baseText.split("\n"), "the class exists at base").toContain("class TestUser:");
      const headText = textOf(head, PY);
      const line = lineStarting(headText, 'pytestmark = pytest.mark.skip(reason="flaky")');
      expect(headText.split("\n")[line - 1]?.startsWith("    pytestmark"), "in the class body").toBe(true);
      expect(headText.split("\n")[line - 2], "right below the class line").toBe("class TestUser:");
      expect(ti03).toEqual([{ severity: "block", path: PY, line, detail: EXISTING }]);
    },
    SLOW,
  );

  it(
    "AC-7: an unguarded pytest.skip(…) added as the first statement of an existing test gives one block TI03 at the pytest.skip line",
    async () => {
      requirePython();
      const { base, head, ti03 } = await runCase("block-pytest-skip-in-body");
      expectTwoUnskippedTests(textOf(base, PY));
      const headText = textOf(head, PY);
      const line = lineStarting(headText, 'pytest.skip("broken")');
      expect(headText.split("\n")[line - 2], "right below the existing def line").toBe("def test_full_name():");
      expect(ti03).toEqual([{ severity: "block", path: PY, line, detail: EXISTING }]);
    },
    SLOW,
  );
});
