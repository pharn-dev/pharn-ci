import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources and check() are loaded inside each test body: the AC tests are written before TI12 and its
// fixtures exist, so nothing the build adds may run while the file loads. The fixtures are written by the build, so
// each test first checks that its diff and fixture text hold the case the AC describes. The real interpreter runs;
// with no python3 of 3.9 or newer on PATH every test fails with that reason, and none is skipped.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const SLOW = 60_000;

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
  const root = `${FIXTURES}test-integrity/TI12/${name}/`;
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
const modified = (diff: string, path: string) => diff.includes(`--- a/${path}\n+++ b/${path}\n`);

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
    repoFiles: [
      ...new Set([
        ...c.head.map((f) => f.path),
        ...[...c.diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1] as string),
      ]),
    ].sort(),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  const typed = report as unknown as Report;
  expect(typed.testIntegrity.languages, "the Python file was compared").toEqual(["py"]);
  return typed;
}

/** The case modifies `test` and `source`, and the head of `test` adds `call` once (absent at base). */
function expectCase(c: Case, test: string, source: string, call: string): void {
  expect(modified(c.diff, test), `${test} is modified`).toBe(true);
  expect(modified(c.diff, source), `${source} is modified`).toBe(true);
  expect(occurrences(textAt(c.base, test), call), `${call} not at base`).toBe(0);
  expect(occurrences(textAt(c.head, test), call), `${call} added at head`).toBe(1);
}

const ti12Of = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI12");

const CAUGHT: ReadonlyArray<{ name: string; test: string; source: string; call: string; mock: string }> = [
  {
    name: "warn-py-patch",
    test: "tests/test_cart.py",
    source: "app/cart.py",
    call: 'patch("app.cart.total")',
    mock: 'patch("app.cart.total")',
  },
  {
    name: "warn-py-mocker-src",
    test: "tests/test_prices.py",
    source: "src/pkg/prices.py",
    call: 'mocker.patch("pkg.prices.lookup")',
    mock: 'mocker.patch("pkg.prices.lookup")',
  },
  {
    name: "warn-py-monkeypatch",
    test: "tests/test_store.py",
    source: "app/store/__init__.py",
    call: 'monkeypatch.setattr("app.store.save", fake)',
    mock: 'monkeypatch.setattr("app.store.save")',
  },
];

const MISSED: ReadonlyArray<{ name: string; call: string }> = [
  { name: "pass-py-patch-object", call: 'patch.object(cart, "total")' },
  { name: "pass-py-third-party", call: 'patch("requests.get")' },
];

describe("TI12 on Python test files, through the Python test index", () => {
  for (const { name, test, source, call, mock } of CAUGHT) {
    it(
      `AC-10: ${call} added to ${test} with ${source} modified gives exactly one warn TI12 whose detail holds ${mock} and ${source}`,
      async () => {
        requirePython();
        const c = loadCase(name);
        expectCase(c, test, source, call);
        const ti12 = ti12Of(await runPython(c));
        expect(ti12).toHaveLength(1);
        expect(ti12[0]?.severity).toBe("warn");
        expect(ti12[0]?.path).toBe(test);
        expect(ti12[0]?.detail).toContain(mock);
        expect(ti12[0]?.detail).toContain(source);
      },
      SLOW,
    );
  }

  for (const { name, call } of MISSED) {
    it(
      `AC-10: ${call} added to tests/test_cart.py with app/cart.py modified gives no TI12`,
      async () => {
        requirePython();
        const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
        expect(typeof core.detectTI12, "TI12 exists, so its absence here is the case's doing").toBe("function");
        const c = loadCase(name);
        expectCase(c, "tests/test_cart.py", "app/cart.py", call);
        expect(ti12Of(await runPython(c))).toEqual([]);
      },
      SLOW,
    );
  }
});
