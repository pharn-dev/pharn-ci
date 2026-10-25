import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources and check() are loaded inside each test body: the AC tests are written before the Python
// index is wired into check(), so nothing the build adds may run while the file loads. The fixtures are written by
// the build, so each test first checks that its fixture text holds the case the AC describes. The real interpreter
// runs; with no python3 of 3.8 or newer on PATH the tests are skipped, and their titles say so.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const SLOW = 60_000;

/** Whether a python3 of 3.8 or newer is on PATH, decided once while the file loads (no build code runs). */
const HAS_PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8))"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return run.status === 0 && run.stdout.trim() === "True";
})();
const SKIP_REASON = HAS_PYTHON ? "" : " (skipped: no python3 of 3.8 or newer found on PATH)";

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

function loadCase(signal: "TI02" | "TI05", name: string): Case {
  const root = `${FIXTURES}test-integrity/${signal}/${name}/`;
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

/** Index the case's Python sources with node-io, then run check() on them in mode block. */
async function runPython(c: Case): Promise<Report> {
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown, index?: unknown): Promise<{ available: boolean } | undefined>;
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
  return report as unknown as Report;
}

const signalsOf = (report: Report, id: string) => report.testIntegrity.signals.filter((s) => String(s.id) === id);

describe("TI02 and TI05 on Python test files, through the Python test index", () => {
  it.skipIf(!HAS_PYTHON)(
    `AC-10: a removed pytest def test_total(): gives one block TI02 and languages ["py"]${SKIP_REASON}`,
    async () => {
      const c = loadCase("TI02", "block-pytest-removed");
      const path = "py/test_total.py";
      expect(c.diff).toContain(`--- a/${path}`);
      expect(textAt(c.base, path)).toMatch(/^def test_total\(\):/m);
      expect(textAt(c.head, path)).not.toMatch(/^def test_total\(/m);

      const report = await runPython(c);
      const ti02 = signalsOf(report, "TI02");
      expect(ti02).toHaveLength(1);
      expect(ti02[0]?.severity).toBe("block");
      expect(ti02[0]?.path).toBe(path);
      expect(ti02[0]?.detail).toContain("test_total");
      expect(report.testIntegrity.languages).toEqual(["py"]);
    },
    SLOW,
  );

  it.skipIf(!HAS_PYTHON)(
    `AC-10: a pytest test renamed with its body unchanged gives no TI02 and languages ["py"]${SKIP_REASON}`,
    async () => {
      const c = loadCase("TI02", "pass-pytest-renamed");
      const path = "py/test_total.py";
      const names = (text: string) => [...text.matchAll(/^def (test_\w+)\(/gm)].map((m) => m[1] as string);
      const base = names(textAt(c.base, path));
      const head = names(textAt(c.head, path));
      expect(
        base.filter((n) => !head.includes(n)),
        "one name is gone",
      ).toHaveLength(1);
      expect(
        head.filter((n) => !base.includes(n)),
        "one name is new",
      ).toHaveLength(1);

      const report = await runPython(c);
      expect(signalsOf(report, "TI02")).toEqual([]);
      expect(report.testIntegrity.languages).toEqual(["py"]);
    },
    SLOW,
  );

  it.skipIf(!HAS_PYTHON)(
    `AC-10: a pytest test whose assert statements are all removed, leaving a call to the code under test, gives one block TI05${SKIP_REASON}`,
    async () => {
      const c = loadCase("TI05", "block-pytest-emptied");
      const path = "py/test_total.py";
      expect(textAt(c.base, path)).toMatch(/^\s+assert\s/m);
      expect(textAt(c.head, path)).not.toMatch(/^\s+assert\s/m);
      expect(textAt(c.head, path)).toMatch(/^def test_\w+\(/m);

      const report = await runPython(c);
      const ti05 = signalsOf(report, "TI05");
      expect(ti05).toHaveLength(1);
      expect(ti05[0]?.severity).toBe("block");
      expect(ti05[0]?.path).toBe(path);
      expect(report.testIntegrity.languages).toEqual(["py"]);
    },
    SLOW,
  );

  it.skipIf(!HAS_PYTHON)(
    `AC-10: a removed def test_total(self): method of class TestCart(unittest.TestCase): gives one block TI02 whose detail holds TestCart › test_total${SKIP_REASON}`,
    async () => {
      const c = loadCase("TI02", "block-unittest-method-removed");
      const path = "py/test_cart.py";
      expect(textAt(c.base, path)).toMatch(/^class TestCart\(unittest\.TestCase\):/m);
      expect(textAt(c.base, path)).toMatch(/^\s+def test_total\(self\):/m);
      expect(textAt(c.head, path)).toMatch(/^class TestCart\(unittest\.TestCase\):/m);
      expect(textAt(c.head, path)).not.toMatch(/def test_total\(/);

      const report = await runPython(c);
      const ti02 = signalsOf(report, "TI02");
      expect(ti02).toHaveLength(1);
      expect(ti02[0]?.severity).toBe("block");
      expect(ti02[0]?.path).toBe(path);
      expect(ti02[0]?.detail).toContain("TestCart › test_total");
      expect(report.testIntegrity.languages).toEqual(["py"]);
    },
    SLOW,
  );
});
