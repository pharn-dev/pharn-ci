import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestSourceFile as SourceFile } from "../src/testSources.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the Skylos sources are read inside the test body: the AC test is written before TI09 and
// fixtures/skylos-nine-sources/deselect-setting/ exist, so nothing that depends on them may run while the file loads.
// (CORE-133: the check that the README and LIMITS say 8 of 9 moved out.)

const REPO_ROOT = "/home/runner/work/demo/demo";
const CASE = "deselect-setting";
const PATH = "vitest.config.ts";

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

describe("Skylos nine: TI09 catches deselect-setting", () => {
  it("AC-18: deselect-setting with its base and head vitest.config.ts gives a block TI09 naming test.include narrowed", async () => {
    const base = sideFiles(`${FIXTURES}skylos-nine-sources/${CASE}/base`);
    const head = sideFiles(`${FIXTURES}skylos-nine-sources/${CASE}/head`);
    expect(
      base.map((f) => f.path),
      "the base side holds vitest.config.ts",
    ).toEqual([PATH]);
    expect(
      head.map((f) => f.path),
      "the head side holds vitest.config.ts",
    ).toEqual([PATH]);
    // The sources hold the case the diff shows: the include list on line 5, narrowed at head.
    expect(base[0]?.text.split("\n")[4]).toContain('include: ["src/**/*.test.ts"]');
    expect(head[0]?.text.split("\n")[4]).toContain('include: ["src/**/*.fast.test.ts"]');

    const { check } = await import("./text-coverage.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: fixture(`skylos-nine/${CASE}/change.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture(`skylos-nine/${CASE}/files.txt`).trim().split("\n"),
      testIntegrityMode: { input: "block" },
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    });
    expectValidReport(report);
    const signals = report.testIntegrity.signals.filter((s) => String(s.id) === "TI09");
    const narrowed = signals.find((s) => s.path === PATH && s.detail.includes("test.include narrowed"));
    expect(narrowed, "a TI09 for vitest.config.ts naming test.include narrowed").toBeDefined();
    expect(narrowed?.severity).toBe("block");
  });
});
