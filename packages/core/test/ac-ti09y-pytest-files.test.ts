import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The controls run in the same test as the cases that trigger.

const REPO_ROOT = "/home/runner/work/demo/demo";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** check() in mode block over one modified pytest settings file with this base and head text; its TI09 signals. */
async function run(path: string, base: string, head: string): Promise<Signal[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(path, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", path],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path, text: base }], dropped: [] },
      head: { files: [{ path, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI09");
}

const PROJECT = '[project]\nname = "demo"\nversion = "1.0.0"\n';
const pyproject = (addopts: string, testpaths: string) =>
  `${PROJECT}\n[tool.pytest.ini_options]\naddopts = ${addopts}\ntestpaths = ${testpaths}\n`;
const setupCfg = (norecursedirs: string, pythonFiles: string) =>
  `[metadata]\nname = demo\n\n[tool:pytest]\nnorecursedirs = ${norecursedirs}\npython_files = ${pythonFiles}\n`;
const toxIni = (testpaths: string) => `[tox]\nenvlist = py312\n\n[pytest]\ntestpaths = ${testpaths}\n`;

describe("TI09: pytest settings in pyproject.toml, setup.cfg and tox.ini", () => {
  it("AC-13: an addopts --ignore and a narrowed testpaths in pyproject.toml and a widened norecursedirs and narrowed python_files in setup.cfg give block TI09, and a tox widening, build directories and a removed table give none", async () => {
    const pyprojectSignals = await run(
      "pyproject.toml",
      pyproject('["-ra"]', '["tests"]'),
      pyproject('["-ra", "--ignore=tests/integration"]', '["tests/unit"]'),
    );
    expect(pyprojectSignals, "pyproject.toml: two TI09 signals").toHaveLength(2);
    expect(pyprojectSignals.every((s) => s.severity === "block" && s.path === "pyproject.toml")).toBe(true);
    expect(pyprojectSignals.some((s) => s.detail.includes("--ignore"))).toBe(true);
    expect(pyprojectSignals.some((s) => s.detail.includes("testpaths narrowed"))).toBe(true);

    const setupSignals = await run(
      "setup.cfg",
      setupCfg(".git", "test_*.py *_test.py"),
      setupCfg(".git legacy", "test_*.py"),
    );
    expect(setupSignals, "setup.cfg: two TI09 signals").toHaveLength(2);
    expect(setupSignals.every((s) => s.severity === "block" && s.path === "setup.cfg")).toBe(true);
    expect(setupSignals.some((s) => s.detail.includes("norecursedirs widened"))).toBe(true);
    expect(setupSignals.some((s) => s.detail.includes("python_files narrowed"))).toBe(true);

    expect(await run("tox.ini", toxIni("tests/unit"), toxIni("tests")), "tox.ini testpaths widened: none").toEqual([]);
    expect(
      await run("setup.cfg", setupCfg(".git", "test_*.py"), setupCfg(".git .venv build", "test_*.py")),
      "norecursedirs gains .venv and build: none",
    ).toEqual([]);
    expect(
      await run("pyproject.toml", pyproject('["-ra"]', '["tests"]'), PROJECT),
      "the pytest table removed: none",
    ).toEqual([]);
  });
});
