import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-70: TI09's key table gains vitest dir, testNamePattern and root, jest roots and modulePathIgnorePatterns, and a
// pytest addopts positional path or -o python_functions, for a config that existed at base. check() is loaded inside
// each test body. Each case is a directory of fixtures/test-integrity/TI09/ (change.diff, base/<path>.txt,
// head/<path>.txt), read as ti09y-fixtures.test.ts reads it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI09 = `${FIXTURES}test-integrity/TI09`;

type Mode = "block" | "warn";

interface SourceFile {
  path: string;
  text: string;
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  try {
    statSync(dir);
  } catch {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

/** The TI09 signals of one case directory run through check() in `mode`; the report is schema-validated. */
async function ti09Of(name: string, mode: Mode) {
  const { check } = await import("../src/check.js");
  const dir = join(TI09, name);
  const diff = readFileSync(join(dir, "change.diff"), "utf8");
  const head = sideFiles(join(dir, "head"));
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", ...head.map((file) => file.path)].sort(),
    testIntegrityMode: { input: mode },
    testSources: {
      base: { files: sideFiles(join(dir, "base")), dropped: [] },
      head: { files: head, dropped: [] },
    },
  });
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => signal.id === "TI09");
}

describe("CORE-70: new TI09 keys in a config that existed at base", () => {
  it("AC-5: vitest test.dir, test.testNamePattern and test.root added each give one TI09 at the mode's level", async () => {
    const cases: Array<[string, string]> = [
      ["block-vitest-dir-added", "test.dir"],
      ["block-vitest-test-name-pattern-added", "test.testNamePattern"],
      ["block-vitest-root-added", "test.root"],
    ];
    for (const mode of ["block", "warn"] as const) {
      for (const [name, key] of cases) {
        const signals = await ti09Of(name, mode);
        expect(signals, `${name} (${mode}): one TI09`).toHaveLength(1);
        expect(signals[0]?.detail, `${name} (${mode}): names ${key}`).toContain(key);
        expect(signals[0]?.severity, `${name} (${mode}): severity`).toBe(mode);
      }
    }
  });

  it("AC-6: jest roots and modulePathIgnorePatterns added each give one block TI09 in mode block", async () => {
    const cases: Array<[string, string]> = [
      ["block-jest-roots-added", "roots"],
      ["block-jest-module-path-ignore-added", "modulePathIgnorePatterns"],
    ];
    for (const [name, key] of cases) {
      const signals = await ti09Of(name, "block");
      expect(signals, `${name}: one TI09`).toHaveLength(1);
      expect(signals[0]?.detail, `${name}: names ${key}`).toContain(key);
      expect(signals[0]?.severity, `${name}: severity`).toBe("block");
    }
  });

  it("AC-7: a pytest addopts that gains a positional path or -o python_functions gives one block TI09 naming addopts", async () => {
    for (const name of ["block-pytest-addopts-path-added", "block-pytest-addopts-python-functions"]) {
      const signals = await ti09Of(name, "block");
      expect(signals, `${name}: one TI09`).toHaveLength(1);
      expect(signals[0]?.detail, `${name}: names addopts`).toContain("addopts");
      expect(signals[0]?.severity, `${name}: severity`).toBe("block");
    }
  });

  it("AC-8: a widened jest roots, a dist modulePathIgnorePatterns and a verbose pytest addopts give no TI09", async () => {
    for (const name of [
      "pass-jest-roots-widened",
      "pass-jest-module-path-ignore-dist",
      "pass-pytest-addopts-verbose",
    ]) {
      expect(await ti09Of(name, "block"), `${name}: no TI09`).toEqual([]);
    }
  });
});
