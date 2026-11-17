import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-54 on Python test files: a conditional skip (`@pytest.mark.skipif(cond)`) no longer excuses a test from TI05
// and TI06; an unconditional `@pytest.mark.skip` still does (TI03 reports the skip). The real interpreter runs; with
// no python3 of 3.8 or newer on PATH the tests fail with that reason, never skip. Each test first checks, through the
// Python test index, that its fixture holds the case it describes.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "py/test_total.py";
const SLOW = 60_000;

/** The python3 on PATH and whether it is 3.8 or newer, decided once while the file loads. */
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
interface Block {
  kind: string;
  name: string;
  line: number;
  modifiers: string[];
  assertionCount: number;
}
interface IndexFile {
  path: string;
  result: { parsed: boolean; tests?: Block[] };
}
interface Run {
  report: { testIntegrity: { signals: Signal[] } };
  base: IndexFile[];
  head: IndexFile[];
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

function loadCase(signal: "TI05" | "TI06", name: string): Case {
  const root = `${FIXTURES}test-integrity/${signal}/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

/** Index the case's Python sources with node-io, then run check() on them in `mode`. */
async function runPython(c: Case, mode: "block" | "warn"): Promise<Run> {
  const io = await import("../src/index.js");
  const sources = { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } };
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  if (pythonTestIndex === undefined || !pythonTestIndex.available) throw new Error("the Python index did not run");

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
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return {
    report: report as unknown as Run["report"],
    base: pythonTestIndex.base as unknown as IndexFile[],
    head: pythonTestIndex.head as unknown as IndexFile[],
  };
}

/** The test of one side's index with this name. */
function testNamed(files: IndexFile[], name: string): Block {
  const file = files.find((f) => f.path === PATH);
  if (file === undefined || !file.result.parsed) throw new Error(`the index has no parsed ${PATH}`);
  const found = (file.result.tests ?? []).filter((b) => b.kind === "test" && b.name === name);
  expect(found, `one test named ${name}`).toHaveLength(1);
  return found[0] as Block;
}

const signalsOf = (run: Run, id: string) => run.report.testIntegrity.signals.filter((s) => s.id === id);

describe("TI05 and TI06 judge a Python test under a conditional skip mark (CORE-54)", () => {
  for (const mode of ["block", "warn"] as const) {
    it(
      `must trigger: a test under @pytest.mark.skipif(cond) with its assertions removed gives one TI05 at the mode's level (${mode})`,
      async () => {
        requirePython();
        const run = await runPython(loadCase("TI05", "block-pytest-skipif-emptied"), mode);
        const base = testNamed(run.base, "test_total");
        const head = testNamed(run.head, "test_total");
        expect(base.modifiers).toEqual(["skipIf"]);
        expect(head.modifiers).toEqual(["skipIf"]);
        expect(base.assertionCount).toBe(2);
        expect(head.assertionCount).toBe(0);

        const ti05 = signalsOf(run, "TI05");
        expect(ti05).toHaveLength(1);
        expect(ti05[0]).toMatchObject({ id: "TI05", severity: mode, path: PATH, line: head.line });
        expect(signalsOf(run, "TI03"), "the mark was already there: no skip added").toEqual([]);
      },
      SLOW,
    );
  }

  it(
    "must trigger: a test under @pytest.mark.skipif(cond) whose assert is weakened gives one TI06 warn",
    async () => {
      requirePython();
      const run = await runPython(loadCase("TI06", "warn-pytest-skipif-weakened"), "block");
      const head = testNamed(run.head, "test_adds_the_prices");
      expect(testNamed(run.base, "test_adds_the_prices").modifiers).toEqual(["skipIf"]);
      expect(head.modifiers).toEqual(["skipIf"]);

      const ti06 = signalsOf(run, "TI06");
      expect(ti06).toHaveLength(1);
      expect(ti06[0]).toMatchObject({ id: "TI06", severity: "warn", path: PATH, line: head.line });
    },
    SLOW,
  );

  it(
    "must not trigger: a test that becomes @pytest.mark.skip and is emptied gives no TI05; TI03 reports the skip",
    async () => {
      requirePython();
      const run = await runPython(loadCase("TI05", "pass-pytest-skip-emptied"), "block");
      expect(testNamed(run.base, "test_total").assertionCount).toBe(2);
      expect(testNamed(run.head, "test_total").modifiers).toEqual(["skip"]);

      expect(signalsOf(run, "TI05")).toEqual([]);
      expect(signalsOf(run, "TI03").length).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "must not trigger: a @pytest.mark.skip test whose assert is weakened gives no TI06",
    async () => {
      requirePython();
      const run = await runPython(loadCase("TI06", "pass-pytest-skip-weakened"), "block");
      expect(testNamed(run.base, "test_adds_the_prices").modifiers).toEqual(["skip"]);
      expect(testNamed(run.head, "test_adds_the_prices").modifiers).toEqual(["skip"]);

      expect(signalsOf(run, "TI06")).toEqual([]);
      expect(signalsOf(run, "TI05")).toEqual([]);
    },
    SLOW,
  );

  it(
    "must not trigger: a test under @pytest.mark.skipif(cond) that the change does not touch gives no TI05 and no TI06",
    async () => {
      requirePython();
      const run = await runPython(loadCase("TI05", "pass-pytest-skipif-unchanged"), "block");
      const base = testNamed(run.base, "test_total");
      const head = testNamed(run.head, "test_total");
      expect(head.modifiers).toEqual(["skipIf"]);
      expect(head.assertionCount).toBe(base.assertionCount);

      expect(run.report.testIntegrity.signals).toEqual([]);
    },
    SLOW,
  );
});
