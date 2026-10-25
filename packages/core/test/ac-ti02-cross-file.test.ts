import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI02 and
// fixtures/test-integrity/TI02/ exist, so nothing that depends on them may run while the file loads. The fixtures are
// written by the build, so each test first checks, through the existing JS/TS test index, that its fixture holds the
// case the AC describes. A case that gives no TI02 must still have been compared: `languages` is `["ts"]`.

const REPO_ROOT = "/home/runner/work/demo/demo";
const A = "src/a.test.ts";
const B = "src/b.test.ts";
const C = "src/c.test.ts";

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

/** The test blocks of one fixture file, through the existing JS/TS test index. */
async function testsOf(file: SourceFile | undefined): Promise<Block[]> {
  if (file === undefined) throw new Error("the fixture file is missing");
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return (result.tests ?? []).filter((b) => b.kind === "test");
}

const fullName = (b: Block) => b.path.join(" › ");
const leaf = (b: Block) => b.path[b.path.length - 1] ?? "";
const fileAt = (files: SourceFile[], path: string) => files.find((f) => f.path === path);
const count = (blocks: Block[], name: string) => blocks.filter((b) => fullName(b) === name).length;
const ti02Of = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");

/** The diff section of one file: from its `diff --git` line to the next one. */
function diffSection(diff: string, path: string): string {
  const parts = diff.split(/^(?=diff --git )/m);
  const part = parts.find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

/** The base tests of `path` whose full name occurs fewer times at head. */
async function removedFrom(c: Case, path: string): Promise<Block[]> {
  const base = await testsOf(fileAt(c.base, path));
  const head = await testsOf(fileAt(c.head, path));
  return base.filter((b) => count(head, fullName(b)) < count(base, fullName(b)));
}

describe("TI02: a test that moves to another touched test file", () => {
  it("AC-4: a test removed from the modified a.test.ts with a test of the same leaf name added to the modified b.test.ts gives no TI02", async () => {
    const c = loadCase("pass-moved-to-other-file");
    expect(diffSection(c.diff, A)).not.toMatch(/^(new|deleted) file mode/m);
    expect(diffSection(c.diff, B)).not.toMatch(/^(new|deleted) file mode/m);
    const removed = await removedFrom(c, A);
    expect(removed, "one test leaves a.test.ts").toHaveLength(1);
    const name = leaf(removed[0] as Block);
    const bBase = await testsOf(fileAt(c.base, B));
    const bHead = await testsOf(fileAt(c.head, B));
    expect(
      bBase.some((b) => leaf(b) === name),
      "b.test.ts has no test of that leaf name at base",
    ).toBe(false);
    expect(
      bHead.some((b) => leaf(b) === name),
      "b.test.ts gains a test of that leaf name",
    ).toBe(true);

    const report = await runCase(c);
    expect(ti02Of(report)).toEqual([]);
    expect(report.testIntegrity.languages).toEqual(["ts"]);
  });

  it("AC-4: a test removed from a.test.ts with a test of another name and the same body in the added c.test.ts gives no TI02", async () => {
    const c = loadCase("pass-moved-to-added-file");
    expect(diffSection(c.diff, A)).not.toMatch(/^(new|deleted) file mode/m);
    expect(diffSection(c.diff, C), "c.test.ts is added").toMatch(/^new file mode/m);
    expect(fileAt(c.base, C), "c.test.ts has no base text").toBeUndefined();
    const removed = await removedFrom(c, A);
    expect(removed, "one test leaves a.test.ts").toHaveLength(1);
    const was = removed[0] as Block;
    const cHead = await testsOf(fileAt(c.head, C));
    const moved = cHead.filter((h) => h.bodyHash === was.bodyHash);
    expect(moved.length, "c.test.ts holds a test with the same body").toBeGreaterThan(0);
    expect(
      moved.every((h) => leaf(h) !== leaf(was)),
      "under another name",
    ).toBe(true);

    const report = await runCase(c);
    expect(ti02Of(report)).toEqual([]);
    expect(report.testIntegrity.languages).toEqual(["ts"]);
  });

  it("AC-4: a test works removed from a.test.ts while the touched b.test.ts holds works at base and at head gives exactly one TI02 for a.test.ts", async () => {
    const c = loadCase("block-common-leaf-elsewhere");
    expect(diffSection(c.diff, A)).not.toMatch(/^(new|deleted) file mode/m);
    expect(diffSection(c.diff, B)).not.toMatch(/^(new|deleted) file mode/m);
    const removed = await removedFrom(c, A);
    expect(removed, "one test leaves a.test.ts").toHaveLength(1);
    const was = removed[0] as Block;
    expect(leaf(was)).toBe("works");
    const aHead = await testsOf(fileAt(c.head, A));
    expect(aHead.some((h) => leaf(h) === "works")).toBe(false);
    const works = (blocks: Block[]) => blocks.filter((b) => leaf(b) === "works").length;
    const bBase = await testsOf(fileAt(c.base, B));
    const bHead = await testsOf(fileAt(c.head, B));
    expect(works(bBase), "b.test.ts holds works at base").toBeGreaterThan(0);
    expect(works(bHead), "and the same number at head").toBe(works(bBase));

    const report = await runCase(c);
    const ti02 = ti02Of(report);
    expect(ti02).toHaveLength(1);
    expect(ti02[0]?.path).toBe(A);
    expect(ti02[0]?.line).toBe(was.line);
    expect(ti02[0]?.severity).toBe("block");
  });
});
