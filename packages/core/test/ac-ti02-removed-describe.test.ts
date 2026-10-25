import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI02 and
// fixtures/test-integrity/TI02/ exist, so nothing that depends on them may run while the file loads. The fixture is
// written by the build, so the test first checks, through the existing JS/TS test index, that it holds the case the AC
// describes, and derives the expected lines and names from the fixture text.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

interface SourceFile {
  path: string;
  text: string;
}
interface Case {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
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
  name: string;
  path: string[];
  line: number;
  endLine: number;
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

function loadCase(name: string): Case {
  const root = `${FIXTURES}test-integrity/TI02/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

async function runCase(c: Case): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

/** Every block (describe, test and hook) of one fixture file, through the existing JS/TS test index. */
async function blocksOf(file: SourceFile | undefined): Promise<Block[]> {
  if (file === undefined) throw new Error("the fixture file is missing");
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return result.tests ?? [];
}

const fullName = (b: Block) => b.path.join(" › ");
const fileAt = (files: SourceFile[], path: string) => files.find((f) => f.path === path);
const within = (b: Block, prefix: readonly string[]) =>
  b.path.length > prefix.length && prefix.every((name, i) => b.path[i] === name);

describe("TI02: a removed describe", () => {
  it("AC-2: a describe with a beforeEach hook and three tests removed gives exactly three TI02 signals, one per test at its base line with its full name, and none for the describe or the hook", async () => {
    const c = loadCase("block-removed-describe");
    expect(c.diff).toContain(`--- a/${PATH}`);
    expect(c.diff).toContain(`+++ b/${PATH}`);

    // The fixture: the base holds describe("totals") with a beforeEach hook and three it tests; the head drops it.
    const baseFile = fileAt(c.base, PATH) as SourceFile;
    const base = await blocksOf(baseFile);
    const head = await blocksOf(fileAt(c.head, PATH));
    const totals = base.filter((b) => b.kind === "describe" && b.name === "totals");
    expect(totals, 'one describe("totals") at base').toHaveLength(1);
    const group = totals[0] as Block;
    const inside = base.filter((b) => within(b, group.path));
    const tests = inside.filter((b) => b.kind === "test");
    const hooks = inside.filter((b) => b.kind === "hook");
    expect(tests, "three tests inside it").toHaveLength(3);
    expect(hooks.length, "a hook inside it").toBeGreaterThanOrEqual(1);
    const lines = baseFile.text.split("\n");
    expect(
      hooks.some((h) => (lines[h.line - 1] ?? "").includes("beforeEach")),
      "the hook is a beforeEach",
    ).toBe(true);
    expect(
      head.some((b) => b.path.includes("totals")),
      "the head holds nothing of the describe",
    ).toBe(false);
    const outside = (blocks: Block[]) =>
      blocks
        .filter((b) => b.kind === "test" && !b.path.includes("totals"))
        .map((b) => `${fullName(b)}#${b.bodyHash}`)
        .sort();
    expect(outside(head), "every other test is unchanged").toEqual(outside(base));

    const report = await runCase(c);
    const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
    expect(ti02).toHaveLength(3);
    expect(ti02.map((s) => s.line).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      tests.map((t) => t.line).sort((a, b) => a - b),
    );
    for (const test of tests) {
      const signal = ti02.find((s) => s.line === test.line);
      expect(signal, fullName(test)).toBeDefined();
      expect(signal?.path).toBe(PATH);
      expect(signal?.severity).toBe("block");
      expect(signal?.detail, fullName(test)).toContain(fullName(test));
    }
    const notTests = [group, ...hooks].map((b) => b.line);
    for (const signal of ti02) expect(notTests, "no signal for the describe or the hook").not.toContain(signal.line);
  });
});
