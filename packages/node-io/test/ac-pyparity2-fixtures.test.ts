import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources and check() are loaded inside the test body: the AC test is written before the pytest parity
// fixtures exist, so nothing the build adds may run while the file loads. The cases are listed from the fixture
// directories; a case is Python when a path its diff names ends in .py (or, for TI09, is a pytest config file). The
// real interpreter builds the Python index for TI02, TI05 and TI06; with no python3 of 3.8 or newer on PATH the test
// fails with that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const IDS = ["TI01", "TI02", "TI03", "TI05", "TI06", "TI09", "TI13"] as const;
const INDEXED: ReadonlySet<string> = new Set(["TI02", "TI05", "TI06"]);
const PYTEST_CONFIGS: ReadonlySet<string> = new Set(["pytest.ini", "tox.ini", "setup.cfg", "pyproject.toml"]);

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
interface Report {
  testIntegrity: { signals: { id: string; severity: string; path: string }[] };
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

/** The paths a diff names in its `diff --git a/<old> b/<new>` lines. */
const diffPaths = (diff: string) =>
  [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].flatMap((m) => [m[1] as string, m[2] as string]);

function isPython(id: string, paths: string[]): boolean {
  return paths.some((p) => p.endsWith(".py") || (id === "TI09" && PYTEST_CONFIGS.has(p.split("/").at(-1) as string)));
}

/** Every case of one directory: a top-level `.diff` file or a case directory holding `change.diff`. */
function casesOf(id: string): { name: string; diff: string; dir: string | null }[] {
  const root = `${FIXTURES}test-integrity/${id}/`;
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith(".diff")) {
        return [
          { name: entry.name.slice(0, -".diff".length), diff: readFileSync(`${root}${entry.name}`, "utf8"), dir: null },
        ];
      }
      if (entry.isDirectory() && existsSync(`${root}${entry.name}/change.diff`)) {
        return [
          {
            name: entry.name,
            diff: readFileSync(`${root}${entry.name}/change.diff`, "utf8"),
            dir: `${root}${entry.name}/`,
          },
        ];
      }
      return [];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function runCase(id: string, c: { name: string; diff: string; dir: string | null }): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const coverage = { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" };
  let input: Record<string, unknown>;
  if (c.dir === null) {
    const files = `${FIXTURES}test-integrity/${id}/${c.name}.files.txt`;
    const repoFiles = readFileSync(existsSync(files) ? files : `${FIXTURES}test-files-deleted/files.txt`, "utf8")
      .trim()
      .split("\n");
    input = { diff: { text: c.diff }, repoFiles };
  } else {
    const base = sideFiles(`${c.dir}base`);
    const head = sideFiles(`${c.dir}head`);
    const testSources = { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };
    input = {
      diff: { text: c.diff },
      repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
      testSources,
    };
    if (INDEXED.has(id)) {
      const io = (await import("../src/index.js")) as unknown as {
        indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
      };
      const pythonTestIndex = await io.indexPythonTestSources(testSources);
      expect(pythonTestIndex?.available, `${id}/${c.name}: the Python index ran`).toBe(true);
      input.pythonTestIndex = pythonTestIndex;
    }
  }
  const report = check({
    version: "0.1.0",
    coverage,
    repoRoot: REPO_ROOT,
    threshold: 80,
    testIntegrityMode: { input: "block" },
    ...input,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("pytest parity: every Python fixture case of the parity signals", () => {
  it("AC-17: TI01, TI02, TI03, TI05, TI06, TI09 and TI13 each have a Python block- or warn- case that gives a signal of that id and a Python pass- case that gives none, TI05 among them through a pytest pass- case, and every report validates", async () => {
    requirePython();
    const summary: Record<string, { triggered: string[]; quiet: string[] }> = {};
    for (const id of IDS) {
      const cases = casesOf(id).filter((c) => isPython(id, diffPaths(c.diff)));
      const triggered: string[] = [];
      const quiet: string[] = [];
      for (const c of cases) {
        const kind = /^(block|warn|pass)-/.exec(c.name)?.[1];
        if (kind === undefined) continue;
        const report = await runCase(id, c);
        const own = report.testIntegrity.signals.filter((s) => String(s.id) === id);
        if (kind === "pass" && own.length === 0) quiet.push(c.name);
        if (kind !== "pass" && own.length > 0) triggered.push(c.name);
      }
      summary[id] = { triggered, quiet };
    }
    for (const id of IDS) {
      expect(summary[id]?.triggered.length, `${id}: a Python block- or warn- case gives a ${id}`).toBeGreaterThan(0);
      expect(summary[id]?.quiet.length, `${id}: a Python pass- case gives no ${id}`).toBeGreaterThan(0);
    }
    expect(summary.TI05?.quiet, "TI05: the new pytest pass- case gives no TI05").toContain(
      "pass-pytest-alias-emptied-skipped",
    );
  }, 300_000);
});
