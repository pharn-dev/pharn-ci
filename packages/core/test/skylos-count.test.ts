import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// release-readiness-v020: the Skylos figure (now 8 of 9) must match what check() does today. Each of the nine Skylos
// cases runs through check() with the inputs the Skylos AC tests use, plus the base and head text of the test file or
// config for the five cases that need it (fixtures/skylos-nine-sources/). check() is loaded inside the test body.
// CORE-133: the caught and missed cases were parsed from docs/LIMITS.md; they are written here instead, as LIMITS
// lists them at this commit, so the figure is still checked against check() without reading the document.

const REPO_ROOT = "/home/runner/work/demo/demo";
const WITH_SOURCES = new Set([
  "emptied-assertion",
  "deselect-setting",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
]);
/** The caught cases and the signal that catches each. */
const CAUGHT: ReadonlyMap<string, string> = new Map([
  ["deleted-test", "TI01"],
  ["added-skip", "TI03"],
  ["emptied-assertion", "TI05"],
  ["deselect-setting", "TI09"],
  ["replaced-test", "TI02"],
  ["loosened-assertion", "TI06"],
  ["edited-expected-value", "TI07"],
  ["always-true-matcher", "TI17"],
]);
/** The missed cases and the signal planned for each. */
const MISSED: ReadonlyMap<string, string> = new Map([["hard-coded-answer", "TI15"]]);

/** The `<logical path>.txt` files under one side of a case's sources, as test-source files sorted by logical path. */
function sideFiles(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// The titles are kept as they were (ac-ti06-ti12-unchanged.test.ts pins them); the lists are CAUGHT and MISSED above.
describe("release-readiness-v020: the LIMITS 2-of-9 figure matches check()", () => {
  it("AC-3: exactly the two cases LIMITS lists as caught give a signal (only their named id), the seven it lists as missed give none, so the live count is 2 of 9", async () => {
    const { check } = await import("./text-coverage.js");
    const caught = CAUGHT;
    const missed = MISSED;
    // ti17-always-true-matcher-2: always-true-matcher moved from the missed list to the caught list (7 and 2 became 8 and 1).
    expect(caught.size).toBe(8);
    expect(missed.size).toBe(1);
    const names = [...caught.keys(), ...missed.keys()];
    expect(new Set(names).size).toBe(9);

    const live = new Map<string, string[]>();
    for (const name of names) {
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
      live.set(
        name,
        report.testIntegrity.signals.map((signal) => String(signal.id)),
      );
    }

    for (const [name, id] of caught) {
      const ids = live.get(name) ?? [];
      expect(ids.length, name).toBeGreaterThan(0);
      expect([...new Set(ids)], name).toEqual([id]);
    }
    for (const name of missed.keys()) expect(live.get(name), name).toEqual([]);

    const liveCaught = [...live].filter(([, ids]) => ids.length > 0).length;
    expect(`${liveCaught} of ${live.size}`).toBe("8 of 9");
  });
});
