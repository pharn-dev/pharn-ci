import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixture are loaded inside the test body: the AC test is written before the
// rename-in-place rule and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run while the
// file loads. The fixture is written by the build, so the test first checks, through the existing JS/TS test index,
// that it holds the case: one test renamed in its slot, its setup kept, a strong matcher made weak. A rename-in-place
// pair is a pair, so TI06 must judge it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/total.test.ts";
const STRONG = /\.(toBe|toEqual|toStrictEqual|toHaveLength|toHaveProperty)\(/;
const WEAK = /\.(toBeTruthy|toBeDefined|toBeFalsy|toBeInstanceOf|not\.toBeNull|not\.toBeUndefined)\(/;

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
interface Block {
  kind: string;
  path: string[];
  line: number;
  body: string;
  bodyHash: string;
}
interface Report {
  testIntegrity: { signals: Signal[]; languages: string[] };
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

async function testsOf(files: SourceFile[], path: string): Promise<Block[]> {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return (result.tests ?? []).filter((b) => b.kind === "test");
}

const fullName = (b: Block) => b.path.join(" › ");
const groupOf = (b: Block) => JSON.stringify(b.path.slice(0, -1));
const leaf = (b: Block) => b.path[b.path.length - 1] ?? "";

describe("TI02 precision: a rename in place that weakens the assertion is judged by TI06", () => {
  it("AC-2: a test renamed in its slot that keeps its setup and makes a strong matcher weak gives no TI02 and one TI06 at the head path and head line", async () => {
    const root = `${FIXTURES}test-integrity-precision/TI02/ti06-rename-weakened/`;
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);

    expect(diff).toContain(`--- a/${PATH}`);
    expect(diff).toContain(`+++ b/${PATH}`);
    expect(diff).not.toMatch(/^(new|deleted) file mode/m);
    const baseTests = await testsOf(base, PATH);
    const headTests = await testsOf(head, PATH);
    const headNames = new Set(headTests.map(fullName));
    const baseNames = new Set(baseTests.map(fullName));
    const gone = baseTests.filter((b) => !headNames.has(fullName(b)));
    const fresh = headTests.filter((h) => !baseNames.has(fullName(h)));
    expect(gone, "one base test is gone by name").toHaveLength(1);
    expect(fresh, "one head test is new by name").toHaveLength(1);
    const was = gone[0] as Block;
    const now = fresh[0] as Block;
    expect(groupOf(now), "in the same describe").toBe(groupOf(was));
    expect(leaf(now)).not.toBe(leaf(was));
    const slot = (tests: Block[], b: Block) => tests.filter((t) => groupOf(t) === groupOf(b)).indexOf(b);
    expect(slot(headTests, now), "in the same slot").toBe(slot(baseTests, was));
    expect(was.body, "the base test asserts with a strong matcher").toMatch(STRONG);
    expect(now.body, "the head test asserts with a weak matcher").toMatch(WEAK);
    expect(now.body, "and the strong one is gone").not.toMatch(STRONG);

    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const signals = report.testIntegrity.signals;
    expect(signals.filter((s) => String(s.id) === "TI02")).toEqual([]);
    const ti06 = signals.filter((s) => String(s.id) === "TI06");
    expect(ti06).toHaveLength(1);
    expect(ti06[0]?.path).toBe(PATH);
    expect(ti06[0]?.line).toBe(now.line);
  });
});
