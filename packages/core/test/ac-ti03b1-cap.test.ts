import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixture are loaded inside the test body: this AC test is written before the TI03 pair pass and its
// fixture exist. The fixture is first checked for its shape: three new skipped tests at the top and 25 existing tests
// moved into a skipped block that exists unchanged on both sides.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

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
  testIntegrity: { signals: Signal[] };
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

function textOf(files: SourceFile[], path: string): string {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no ${path}`);
  return file.text;
}

describe("TI03 keeps the existing-test findings first under the per-file cap", () => {
  it("AC-11: three new skipped tests above 25 existing tests moved into an unchanged describe.skip give exactly 20 TI03 for the file, every one block", async () => {
    const root = `${FIXTURES}test-integrity/TI03/block-cap-moved-into-skipped/`;
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);
    const baseLines = textOf(base, PATH).split("\n");
    const headLines = textOf(head, PATH).split("\n");
    expect(baseLines, "the skipped block exists at base").toContain('describe.skip("legacy", () => {');
    expect(headLines, "and at head").toContain('describe.skip("legacy", () => {');
    const fresh = headLines.filter((line) => /^it\.skip\("new [123]", \(\) => \{$/.test(line));
    expect(fresh, "three new skipped tests at head").toHaveLength(3);
    expect(
      baseLines.some((line) => line.includes('"new ')),
      "which are not at base",
    ).toBe(false);
    for (let i = 1; i <= 25; i++) {
      expect(baseLines, `t${i} is a top-level test at base`).toContain(`it("t${i}", () => {`);
      expect(headLines, `t${i} sits in the skipped block at head`).toContain(`  it("t${i}", () => {`);
    }
    const firstMoved = headLines.indexOf('  it("t1", () => {');
    const lastFresh = Math.max(...fresh.map((line) => headLines.indexOf(line)));
    expect(lastFresh, "the new skipped tests come first, on lower lines").toBeLessThan(firstMoved);

    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [PATH, "src/cart.ts"],
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    const signals = (report as unknown as Report).testIntegrity.signals.filter(
      (s) => String(s.id) === "TI03" && s.path === PATH,
    );
    expect(signals).toHaveLength(20);
    expect(signals.map((s) => s.severity)).toEqual(Array.from({ length: 20 }, () => "block"));
  });
});
