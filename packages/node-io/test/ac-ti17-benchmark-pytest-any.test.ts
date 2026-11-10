import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// ti17-always-true-matcher-2, AC-2. The pytest Skylos variant always-true-matcher-any (`== 5` becomes `== ANY`) is
// read unchanged. The index and check() are loaded inside the test body: the AC test is written before TI17 exists.
// With no python3 of 3.8 or newer on PATH the test fails with that reason, never skips. The expected signal is written
// here.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ROOT = `${FIXTURES}skylos-nine-pytest/always-true-matcher-any/`;
const REPO_ROOT = "/home/runner/work/demo/demo";
const SLOW = 120_000;

const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

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

/** The `<logical path>.txt` files under one side of the case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function run(withIndex: boolean) {
  const { check } = await import("@pharn-ci/core");
  let extra: Record<string, unknown> = {};
  if (withIndex) {
    const sources = {
      base: { files: sideFiles(`${ROOT}base`), dropped: [] },
      head: { files: sideFiles(`${ROOT}head`), dropped: [] },
    };
    const io = (await import("../src/index.js")) as unknown as {
      indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
    };
    const pythonTestIndex = await io.indexPythonTestSources(sources);
    expect(pythonTestIndex?.available, "the Python index ran").toBe(true);
    extra = { testSources: sources, pythonTestIndex };
  }
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: readFileSync(`${ROOT}change.diff`, "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: readFileSync(`${ROOT}files.txt`, "utf8").trim().split("\n"),
    testIntegrityMode: { input: "block" },
    ...extra,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("TI17 on the pytest Skylos variant always-true-matcher-any", () => {
  it(
    "AC-2: with the real Python index and from the diff alone, the report holds exactly one test-integrity signal, TI17 warn at tests/test_cart.py:10",
    async () => {
      requirePython();
      for (const withIndex of [true, false]) {
        const report = await run(withIndex);
        expect(
          report.testIntegrity.signals.map((s) => ({
            id: String(s.id),
            severity: s.severity,
            path: s.path,
            line: s.line,
          })),
          withIndex ? "with the Python index" : "from the diff alone",
        ).toEqual([{ id: "TI17", severity: "warn", path: "tests/test_cart.py", line: 10 }]);
      }
    },
    SLOW,
  );
});
