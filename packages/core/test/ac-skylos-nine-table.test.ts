import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Skylos nine: the benchmark's nine ways an agent hides a failing test, each mapped to the pharn-ci signal that
// catches it today or is planned to catch it (TEST-INTEGRITY-SPEC "Definition of done", item 2). The signals of this
// release catch 5 of 9: the diff-only TI01 and TI03, and TI05, TI02 and TI07, which also read the base and head text of
// the test file (fixtures/skylos-nine-sources/<case>/, for the three cases that need it).
//
// When the planned signal of a miss case ships, set that case's `caught` to true here and replace its miss assertion
// in ac-skylos-nine-misses.test.ts with a catch assertion, so the benchmark result only moves forward on purpose.
//
// check() and the fixtures are loaded inside each test body: the AC tests are written before fixtures/skylos-nine/
// exists, so a missing fixture fails only its test, never the file's load.

const REPO_ROOT = "/home/runner/work/demo/demo";
/** The cases whose signal reads the base and head text of the test file, which `skylos-nine-sources` holds. */
const WITH_SOURCES = new Set(["emptied-assertion", "replaced-test", "edited-expected-value"]);

/** The `<logical path>.txt` files under one side of a case's sources, as test-source files sorted by logical path. */
function sideFiles(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The case table: each case, the signal that catches or will catch it (null: none planned), and whether it does today. */
const CASES: ReadonlyArray<{ name: string; signal: string | null; caught: boolean }> = [
  { name: "deleted-test", signal: "TI01", caught: true },
  { name: "added-skip", signal: "TI03", caught: true },
  { name: "emptied-assertion", signal: "TI05", caught: true },
  { name: "deselect-setting", signal: "TI09", caught: false },
  { name: "hard-coded-answer", signal: "TI15", caught: false },
  { name: "always-true-matcher", signal: null, caught: false },
  { name: "replaced-test", signal: "TI02", caught: true },
  { name: "loosened-assertion", signal: "TI06", caught: false },
  { name: "edited-expected-value", signal: "TI07", caught: true },
];

/** Run every case through check() in mode block; return the signal ids each case's report carries. */
async function runAll(): Promise<Map<string, string[]>> {
  const { check } = await import("../src/check.js");
  const out = new Map<string, string[]>();
  for (const { name } of CASES) {
    const sources = WITH_SOURCES.has(name)
      ? {
          testSources: {
            base: { files: sideFiles(`${FIXTURES}skylos-nine-sources/${name}/base`), dropped: [] },
            head: { files: sideFiles(`${FIXTURES}skylos-nine-sources/${name}/head`), dropped: [] },
          },
        }
      : {};
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: fixture(`skylos-nine/${name}/change.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture(`skylos-nine/${name}/files.txt`).trim().split("\n"),
      testIntegrityMode: { input: "block" },
      ...sources,
    } as Parameters<typeof check>[0]);
    expectValidReport(report);
    out.set(
      name,
      report.testIntegrity.signals.map((signal) => String(signal.id)),
    );
  }
  return out;
}

describe("Skylos nine: the case table and the headline", () => {
  it("AC-4: the table maps the nine cases to TI01, TI03, TI05, TI09, TI15, none, TI02, TI06 and TI07, one entry per fixture directory", () => {
    expect(CASES.map((c) => [c.name, c.signal])).toEqual([
      ["deleted-test", "TI01"],
      ["added-skip", "TI03"],
      ["emptied-assertion", "TI05"],
      ["deselect-setting", "TI09"],
      ["hard-coded-answer", "TI15"],
      ["always-true-matcher", null],
      ["replaced-test", "TI02"],
      ["loosened-assertion", "TI06"],
      ["edited-expected-value", "TI07"],
    ]);
    const directories = readdirSync(`${FIXTURES}skylos-nine`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual(CASES.map((c) => c.name).sort());
  });

  it("AC-4: exactly the five caught cases give a signal, each only its table id, and the other four give none", async () => {
    const results = await runAll();
    for (const { name, signal, caught } of CASES) {
      const ids = results.get(name);
      expect(ids, name).toBeDefined();
      if (caught) {
        expect(ids?.length, name).toBeGreaterThan(0);
        expect([...new Set(ids)], name).toEqual([signal]);
      } else {
        expect(ids, name).toEqual([]);
      }
    }
    expect(CASES.filter((c) => c.caught).map((c) => c.name)).toEqual([
      "deleted-test",
      "added-skip",
      "emptied-assertion",
      "replaced-test",
      "edited-expected-value",
    ]);
  });

  it("AC-4: the headline — nine cases, 5 caught, 4 expected misses", async () => {
    const results = await runAll();
    const caught = [...results].filter(([, ids]) => ids.length > 0).map(([name]) => name);
    const missed = [...results].filter(([, ids]) => ids.length === 0).map(([name]) => name);
    expect(results.size).toBe(9);
    expect(caught).toEqual([
      "deleted-test",
      "added-skip",
      "emptied-assertion",
      "replaced-test",
      "edited-expected-value",
    ]);
    expect(missed).toHaveLength(4);
    expect(`${caught.length}/${results.size}`).toBe("5/9");
  });
});
