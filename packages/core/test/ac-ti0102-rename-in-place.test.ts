import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before the
// rename-in-place rule and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run while the
// file loads. The fixtures are written by the build, so each test first checks, through the existing JS/TS test index,
// that its fixture holds the case the AC describes (corpus pattern: a test renamed in its slot of the same describe).

const REPO_ROOT = "/home/runner/work/demo/demo";

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
interface Entry {
  path: string;
  name: string;
  line: number;
}
interface Block {
  kind: string;
  name: string;
  path: string[];
  line: number;
  endLine: number;
  body: string;
  bodyHash: string;
  assertionCount: number;
  assertions: { chain: string }[];
  modifiers: string[];
}
interface Report {
  testIntegrity: {
    signals: Signal[];
    languages: string[];
    changes?: { added: Entry[]; removed: Entry[]; modified: Entry[]; renamed: Entry[] };
  };
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
  const root = `${FIXTURES}test-integrity-precision/TI02/${name}/`;
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
const ti02Of = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");

/** The diff section of one file: from its `diff --git` line to the next one. */
function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

/** The one base test whose full name is gone at head and the one head test whose full name is new, in one group. */
async function renamedPair(c: Case, path: string): Promise<{ was: Block; now: Block; base: Block[]; head: Block[] }> {
  const section = diffSection(c.diff, path);
  expect(section, `${path} is modified, not added or deleted`).not.toMatch(/^(new|deleted) file mode/m);
  const base = await testsOf(c.base, path);
  const head = await testsOf(c.head, path);
  const headNames = new Set(head.map(fullName));
  const baseNames = new Set(base.map(fullName));
  const gone = base.filter((b) => !headNames.has(fullName(b)));
  const fresh = head.filter((h) => !baseNames.has(fullName(h)));
  expect(gone, "exactly one base test is gone by its full name").toHaveLength(1);
  expect(fresh, "exactly one head test is new by its full name").toHaveLength(1);
  const was = gone[0] as Block;
  const now = fresh[0] as Block;
  expect(groupOf(now), "the new test sits in the same describe").toBe(groupOf(was));
  expect(leaf(now), "under another name").not.toBe(leaf(was));
  expect(now.bodyHash, "with a body that is not identical").not.toBe(was.bodyHash);
  expect(head.length, "the file keeps its test count").toBe(base.length);
  const slot = (tests: Block[], b: Block) => tests.filter((t) => groupOf(t) === groupOf(b)).indexOf(b);
  expect(slot(head, now), "in the same slot of its group").toBe(slot(base, was));
  return { was, now, base, head };
}

function expectRenamedNoTi02(report: Report, path: string, now: Block): void {
  expect(ti02Of(report)).toEqual([]);
  expect(report.testIntegrity.languages, "the file was compared").toEqual(["ts"]);
  const changes = report.testIntegrity.changes;
  expect(changes, "testIntegrity.changes is present").toBeDefined();
  const renamed = changes?.renamed ?? [];
  expect(renamed).toContainEqual({ path, name: fullName(now), line: now.line });
  expect(
    (changes?.added ?? []).some((e) => e.path === path && e.name === fullName(now)),
    "the head test is not listed as added",
  ).toBe(false);
}

const chains = (b: Block) => b.assertions.map((a) => a.chain);

describe("TI02 precision: a test renamed in place in its describe", () => {
  it("AC-1: a describe of one test renamed, its setup moved into the body and the same toThrowError assertion kept, gives no TI02 and lists the head test as renamed", async () => {
    const path = "src/parse.test.ts";
    const c = loadCase("pass-rename-setup-moved");
    const { was, now, base, head } = await renamedPair(c, path);
    expect(
      base.filter((b) => groupOf(b) === groupOf(was)),
      "the describe holds exactly one test at base",
    ).toHaveLength(1);
    expect(
      head.filter((h) => groupOf(h) === groupOf(now)),
      "and at head",
    ).toHaveLength(1);
    expect(
      chains(was).some((chain) => chain.includes("toThrowError")),
      "the base test asserts toThrowError",
    ).toBe(true);
    expect(
      chains(now).some((chain) => chain.includes("toThrowError")),
      "and so does the head test",
    ).toBe(true);

    expectRenamedNoTi02(await runCase(c), path, now);
  });

  it("AC-1: a test renamed in the same slot with the same setup whose toEqual([]) becomes rejects.toThrow() gives no TI02 and lists the head test as renamed", async () => {
    const path = "src/load.test.ts";
    const c = loadCase("pass-rename-assertion-changed");
    const { was, now } = await renamedPair(c, path);
    expect(was.body, "the base test asserts toEqual([])").toMatch(/\.toEqual\(\s*\[\s*\]\s*\)/);
    expect(now.body, "the head test asserts rejects.toThrow()").toMatch(/\.rejects\.toThrow\(/);
    expect(now.body, "and no longer toEqual([])").not.toMatch(/\.toEqual\(\s*\[\s*\]\s*\)/);

    expectRenamedNoTi02(await runCase(c), path, now);
  });

  it("AC-1: a one-line test renamed with its expected literal changed gives no TI02 and lists the head test as renamed", async () => {
    const path = "src/format.test.ts";
    const c = loadCase("pass-rename-literal-changed");
    const { was, now } = await renamedPair(c, path);
    expect(was.endLine, "the base test is one line").toBe(was.line);
    expect(now.endLine, "the head test is one line").toBe(now.line);
    expect(chains(now), "the same assertion chains").toEqual(chains(was));

    expectRenamedNoTi02(await runCase(c), path, now);
  });
});
