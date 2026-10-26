import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources and check() are loaded inside the test body: the AC test is written before the Python index
// resolves aliases, so nothing the build adds may run while the file loads. The case directories are written by the
// build, so the test first checks that each holds the alias AC-10 names and that its literal twin differs only in the
// spelling. Whether a case must trigger is written here, not read from its name. The real interpreter runs; with no
// python3 of 3.8 or newer on PATH the test fails with that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
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

function loadCase(dir: string): Case {
  const root = `${FIXTURES}test-integrity/${dir}/`;
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
const linesOf = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));

/** Index the case's Python sources with node-io, then run check() on them in mode block. */
async function runPython(c: Case): Promise<Signal[]> {
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
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  const typed = report as unknown as Report;
  expect(typed.testIntegrity.languages, "the Python file was compared").toEqual(["py"]);
  return typed.testIntegrity.signals.map((s) => ({
    id: String(s.id),
    severity: s.severity,
    path: s.path,
    line: s.line,
    detail: s.detail,
  }));
}

/**
 * Each AC-10 case: its directory, the test file, the alias import its texts hold, the alias spellings and their literal
 * twins (each pair must differ only there), and whether the case must give a signal of its directory's id.
 */
const CASES: {
  dir: string;
  path: string;
  imports: string[];
  respell: [string, string][];
  trigger: boolean;
  check: (c: Case) => void;
}[] = [
  {
    dir: "TI05/block-pytest-alias-raises-removed",
    path: "py/test_total.py",
    imports: ["import pytest as pt"],
    respell: [["pt.raises(", "pytest.raises("]],
    trigger: true,
    check: (c) => {
      const base = textAt(c.base, "py/test_total.py");
      const head = textAt(c.head, "py/test_total.py");
      expect(base, "base: the only assertion is with pt.raises(ValueError):").toMatch(
        /^\s+with pt\.raises\(ValueError\):$/m,
      );
      expect(base, "base: no assert statement").not.toMatch(/^\s+assert\s/m);
      expect(head, "head: the raises is gone").not.toContain("raises(");
      expect(head, "head: the call stays").toMatch(/total\(\[-1\]\)/);
      expect(head, "head: def test_rejects is kept").toMatch(/^def test_rejects\(/m);
    },
  },
  {
    dir: "TI05/pass-pytest-alias-emptied-skipped",
    path: "py/test_total.py",
    imports: ["import pytest as pt"],
    respell: [["@pt.mark.skip", "@pytest.mark.skip"]],
    trigger: false,
    check: (c) => {
      const base = textAt(c.base, "py/test_total.py");
      const head = textAt(c.head, "py/test_total.py");
      expect(base, "base: the test asserts").toMatch(/^\s+assert\s/m);
      expect(head, "head: @pt.mark.skip added").toMatch(/^@pt\.mark\.skip/m);
      expect(base, "base: no skip").not.toContain("@pt.mark.skip");
    },
  },
  {
    dir: "TI02/pass-pytest-alias-fixture-removed",
    path: "py/test_total.py",
    imports: ["from pytest import fixture as fx"],
    respell: [["@fx", "@pytest.fixture"]],
    trigger: false,
    check: (c) => {
      const base = textAt(c.base, "py/test_total.py");
      const head = textAt(c.head, "py/test_total.py");
      expect(base, "base: @fx on def test_data()").toMatch(/^@fx\ndef test_data\(\):/m);
      expect(head, "head: test_data is gone").not.toMatch(/def test_data\(/);
      expect(head, "head: a real test is kept").toMatch(/^def test_\w+\(/m);
    },
  },
  {
    dir: "TI02/block-pytest-alias-marked-removed",
    path: "py/test_total.py",
    imports: ["import pytest as pt"],
    respell: [["@pt.mark.parametrize(", "@pytest.mark.parametrize("]],
    trigger: true,
    check: (c) => {
      const base = textAt(c.base, "py/test_total.py");
      const head = textAt(c.head, "py/test_total.py");
      const m = /^@pt\.mark\.parametrize\([^\n]*\)\ndef (test_\w+)\(/m.exec(base);
      expect(m, "base: a test decorated @pt.mark.parametrize").not.toBeNull();
      expect(head, "head: that test is gone").not.toContain(`def ${m?.[1]}(`);
    },
  },
  {
    dir: "TI06/warn-pytest-alias-approx-truthy",
    path: "tests/test_cart.py",
    imports: ["from pytest import approx as ax"],
    respell: [["ax(3.0)", "pytest.approx(3.0)"]],
    trigger: true,
    check: (c) => {
      const base = textAt(c.base, "tests/test_cart.py");
      const head = textAt(c.head, "tests/test_cart.py");
      expect(base, "base: assert total == ax(3.0)").toMatch(/^\s+assert total == ax\(3\.0\)$/m);
      expect(head, "head: assert total").toMatch(/^\s+assert total$/m);
      expect(head, "head: the approx is gone").not.toContain("ax(3.0)");
    },
  },
];

describe("TI02, TI05 and TI06 on Python test files that use aliases, through the Python test index", () => {
  it(
    "AC-10: each aliased case gives exactly the signals of its literal twin; the must-trigger cases give a signal of their directory's id and the must-not-trigger cases none",
    async () => {
      requirePython();
      for (const spec of CASES) {
        const id = spec.dir.split("/")[0] as string;
        const alias = loadCase(spec.dir);
        const literal = loadCase(`${spec.dir}-literal`);
        expect(alias.diff, spec.dir).toContain(`+++ b/${spec.path}`);
        for (const side of ["base", "head"] as const) {
          const lines = linesOf(textAt(alias[side], spec.path));
          for (const imp of spec.imports) expect(lines, `${spec.dir} ${side}: ${imp}`).toContain(imp);
        }
        spec.check(alias);

        // The twin: `import pytest` where the alias import was, the literal spelling where the alias was.
        for (const side of ["base", "head"] as const) {
          const a = linesOf(textAt(alias[side], spec.path));
          const l = linesOf(textAt(literal[side], spec.path));
          expect(l.length, `${spec.dir}-literal ${side}: the same number of lines`).toBe(a.length);
          a.forEach((line, i) => {
            const expected = spec.imports.includes(line)
              ? "import pytest"
              : spec.respell.reduce((t, [from, to]) => t.split(from).join(to), line);
            expect(l[i], `${spec.dir}-literal ${side}: line ${i + 1}`).toBe(expected);
          });
        }

        const twin = await runPython(literal);
        const aliased = await runPython(alias);
        const own = twin.filter((s) => s.id === id);
        if (spec.trigger) expect(own.length, `${spec.dir}-literal: at least one ${id}`).toBeGreaterThan(0);
        else expect(own, `${spec.dir}-literal: no ${id}`).toEqual([]);
        expect(aliased, `${spec.dir}: the signals of its literal twin`).toEqual(twin);
      }
    },
    SLOW,
  );
});
