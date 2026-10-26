import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The two evasions review named: a name is what a change controls, so a name alone must never loosen a gate. (1) A real
// test deleted and a hollow test with a similar name added in its place (the file keeps its test count) is a TI02 block.
// (2) A deleted test file whose every test and group name comes back in an added file, with trivial assertions, is a
// TI01 block: the TI01 moved-tests rule also needs each test's body to be found again.

const REPO_ROOT = "/home/runner/work/demo/demo";

interface SourceFile {
  path: string;
  text: string;
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { verdict: string; signals: Signal[] };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function sideFiles(dir: string): SourceFile[] {
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

function run(dir: string): Report {
  const root = `${FIXTURES}test-integrity-precision/${dir}/`;
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: readFileSync(`${root}change.diff`, "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]) as unknown as Report;
  expectValidReport(report);
  return report;
}

describe("TI01 and TI02 precision: a similar name never softens a block", () => {
  it("AC-6: a real test replaced by a hollow test with a similar name in the same describe, the count kept, is one TI02 block", () => {
    const report = run("TI02/block-hollow-similar-name");
    const ti02 = report.testIntegrity.signals.filter((s) => s.id === "TI02");
    expect(ti02.map((s) => `${s.severity} ${s.path}:${s.line}`)).toEqual(["block src/cart.test.ts:11"]);
    expect(ti02[0]?.detail).toBe(
      'The test "cart › removes an item" at line 11 of the base is gone at head, and no test with the same name or a similar body takes its place.',
    );
    expect(report.testIntegrity.verdict).toBe("fail");
  });

  it("AC-9: a deleted test file whose names all come back in an added file with trivial assertions is a TI01 block", () => {
    const report = run("TI01/block-trivial-same-names");
    const ti01 = report.testIntegrity.signals.filter((s) => s.id === "TI01");
    expect(ti01.map((s) => `${s.severity} ${s.path}`)).toEqual(["block test/pricing.test.ts"]);
    expect(ti01[0]?.detail).toBe("Test file deleted; its removed lines defined tests.");
    expect(report.testIntegrity.verdict).toBe("fail");
  });
});
