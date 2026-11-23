import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestIntegritySignal as Signal } from "../src/report.js";
import type { TestSourceFile as SourceFile } from "../src/testSources.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the Skylos sources are loaded inside each test body: the AC tests are written before TI02,
// TI05 and fixtures/skylos-nine-sources/ exist, so nothing that depends on them may run while the file loads. Each of
// the nine cases runs through check() as the Skylos AC tests run it, with base and head text for the three cases the
// base-and-head signals read. The fixture text is checked to hold the case before its result is read.
// (CORE-133: the check that LIMITS and the README say 8 of 9 moved out.)

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

const NINE = [
  "deleted-test",
  "added-skip",
  "emptied-assertion",
  "deselect-setting",
  "hard-coded-answer",
  "always-true-matcher",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
] as const;
const CAUGHT: ReadonlyMap<string, string> = new Map([
  ["deleted-test", "TI01"],
  ["added-skip", "TI03"],
  ["emptied-assertion", "TI05"],
  ["deselect-setting", "TI09"],
  // ti17-always-true-matcher-2: always-true-matcher is caught by TI17 now (7 of 9 became 8 of 9).
  ["always-true-matcher", "TI17"],
  ["replaced-test", "TI02"],
  ["loosened-assertion", "TI06"],
  ["edited-expected-value", "TI07"],
]);
const WITH_SOURCES = new Set([
  "emptied-assertion",
  "deselect-setting",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
]);

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

async function runNine(): Promise<Map<string, Signal[]>> {
  const { check } = await import("./text-coverage.js");
  const out = new Map<string, Signal[]>();
  for (const name of NINE) {
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
    });
    expectValidReport(report);
    out.set(name, report.testIntegrity.signals);
  }
  return out;
}

describe("Skylos nine: TI05 and TI02 catch emptied-assertion and replaced-test", () => {
  it("AC-17: emptied-assertion gives a block TI05, replaced-test a block TI02, edited-expected-value a warn TI07, loosened-assertion a warn TI06, deselect-setting a block TI09, deleted-test and added-skip their TI01 and TI03 as before, always-true-matcher a warn TI17, and the other one no signal", async () => {
    // The two sources hold the case their diff shows: the expect on the edited line at base, a bare call at head;
    // and the removed test's name at base, the new name at head.
    const emptied = (side: string) =>
      readFileSync(`${FIXTURES}skylos-nine-sources/emptied-assertion/${side}/${PATH}.txt`, "utf8").split("\n");
    expect(emptied("base")[7]).toContain("expect(total([2, 3])).toBe(5);");
    expect(emptied("head")[7]).toContain("total([2, 3]);");
    expect(emptied("head")[7]).not.toContain("expect");
    const replaced = (side: string) =>
      readFileSync(`${FIXTURES}skylos-nine-sources/replaced-test/${side}/${PATH}.txt`, "utf8").split("\n");
    expect(replaced("base")[14]).toContain('it("rejects a negative price"');
    expect(replaced("head")[14]).toContain('it("accepts an empty cart"');
    expect(replaced("head").join("\n")).not.toContain("rejects a negative price");

    const results = await runNine();
    expect(results.size).toBe(9);
    for (const name of NINE) {
      const signals = results.get(name) ?? [];
      const id = CAUGHT.get(name);
      if (id === undefined) {
        expect(signals, `${name}: no signal`).toEqual([]);
        continue;
      }
      expect(signals.length, `${name}: caught`).toBeGreaterThan(0);
      expect([...new Set(signals.map((s) => String(s.id)))], `${name}: only ${id}`).toEqual([id]);
    }
    const emptiedSignal = results.get("emptied-assertion")?.[0];
    expect(emptiedSignal?.severity).toBe("block");
    expect(emptiedSignal?.path).toBe(PATH);
    const replacedSignal = results.get("replaced-test")?.[0];
    expect(replacedSignal?.severity).toBe("block");
    expect(replacedSignal?.path).toBe(PATH);
    expect(replacedSignal?.line).toBe(15);
    expect([...results].filter(([, s]) => s.length > 0).map(([name]) => name)).toEqual([
      "deleted-test",
      "added-skip",
      "emptied-assertion",
      "deselect-setting",
      "always-true-matcher",
      "replaced-test",
      "loosened-assertion",
      "edited-expected-value",
    ]);
  });
});
