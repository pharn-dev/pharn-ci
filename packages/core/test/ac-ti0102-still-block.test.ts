import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before the new
// TI02 rules and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run while the file
// loads. The fixtures are written by the build, so each test first checks, through the existing JS/TS test index,
// that its fixture holds the case. These are the must-still-trigger cases: a deleted test that the rename-in-place,
// `.each`, cross-file and rename-hint rules must not clear or soften.

const REPO_ROOT = "/home/runner/work/demo/demo";
/** The dotted callee called first inside `expect(`, after an optional `await`. */
const SUBJECT = /expect\(\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;

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
  path: string[];
  line: number;
  body: string;
  bodyHash: string;
  modifiers: string[];
}
interface Report {
  verdict: string;
  testIntegrity: { verdict: string; signals: Signal[]; languages: string[] };
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
const words = (text: string) => new Set([...text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0]));
const subjects = (body: string) => new Set([...body.matchAll(SUBJECT)].map((m) => m[1] as string));
function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 1;
  return [...a].filter((x) => b.has(x)).length / union;
}

function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

interface Shape {
  base: Block[];
  head: Block[];
  /** The one base test gone at head by full name and by exact body: the deleted test. */
  target: Block;
  /** The head tests whose full name is not at base. */
  fresh: Block[];
}

async function shapeOf(c: Case, path: string): Promise<Shape> {
  expect(diffSection(c.diff, path), `${path} is modified`).not.toMatch(/^(new|deleted) file mode/m);
  const base = await testsOf(c.base, path);
  const head = await testsOf(c.head, path);
  const headNames = new Set(head.map(fullName));
  const baseNames = new Set(base.map(fullName));
  const headBodies = new Set(head.map((h) => h.bodyHash));
  const deleted = base.filter((b) => !headNames.has(fullName(b)) && !headBodies.has(b.bodyHash));
  expect(deleted, "exactly one base test is gone by name and by body").toHaveLength(1);
  return { base, head, target: deleted[0] as Block, fresh: head.filter((h) => !baseNames.has(fullName(h))) };
}

async function runBlock(c: Case): Promise<Report> {
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
  } as unknown as Parameters<typeof check>[0]) as unknown as Report;
  expectValidReport(report);
  return report;
}

function expectOneBlock(report: Report, path: string, target: Block): void {
  const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
  expect(ti02).toHaveLength(1);
  expect(ti02[0]?.severity).toBe("block");
  expect(ti02[0]?.path).toBe(path);
  expect(ti02[0]?.line).toBe(target.line);
  expect(report.testIntegrity.verdict).toBe("fail");
}

describe("TI02 precision: a deleted test still blocks", () => {
  it("AC-6: (a) a describe and its only test deleted while the file gains an unrelated describe with more tests gives one block TI02 at the deleted test", async () => {
    const path = "src/store.test.ts";
    const c = loadCase("block-group-replaced");
    const { base, head, target } = await shapeOf(c, path);
    expect(
      base.filter((b) => groupOf(b) === groupOf(target)),
      "the describe holds only that test",
    ).toHaveLength(1);
    expect(
      head.some((h) => groupOf(h) === groupOf(target)),
      "the describe is gone at head",
    ).toBe(false);
    expect(head.length, "the file's test count grows").toBeGreaterThan(base.length);

    expectOneBlock(await runBlock(c), path, target);
  });

  it("AC-6: (b) a test pinning a bug deleted while its it.fails sibling becomes a plain it with the same body gives one block TI02 at the deleted test", async () => {
    const path = "src/bug.test.ts";
    const c = loadCase("block-fails-fixed");
    const { base, head, target } = await shapeOf(c, path);
    const fails = base.filter((b) => b.modifiers.includes("fails"));
    expect(fails, "the base holds one it.fails test").toHaveLength(1);
    expect(
      head.some((h) => h.modifiers.includes("fails")),
      "the head holds none",
    ).toBe(false);
    const sibling = fails[0] as Block;
    expect(
      head.some((h) => h.bodyHash === sibling.bodyHash && h.modifiers.length === 0),
      "it is a plain it with the same body at head",
    ).toBe(true);
    expect(head.length, "the file's test count falls by one").toBe(base.length - 1);

    expectOneBlock(await runBlock(c), path, target);
  });

  it("AC-6: (c) a test replaced in the same slot by a dissimilar test gives one block TI02 at the replaced test", async () => {
    const path = "src/cart.test.ts";
    const c = loadCase("block-slot-dissimilar");
    const { base, head, target, fresh } = await shapeOf(c, path);
    expect(fresh, "one new test takes the slot").toHaveLength(1);
    const now = fresh[0] as Block;
    expect(groupOf(now), "in the same describe").toBe(groupOf(target));
    const slot = (tests: Block[], b: Block) => tests.filter((t) => groupOf(t) === groupOf(b)).indexOf(b);
    expect(slot(head, now), "in the same slot").toBe(slot(base, target));
    expect(head.length).toBe(base.length);
    expect(jaccard(words(leaf(now)), words(leaf(target))), "under a dissimilar name").toBeLessThan(0.5);

    expectOneBlock(await runBlock(c), path, target);
  });

  it("AC-6: (d) a test replaced by an .each test of a dissimilar name in the same describe that calls another function gives one block TI02 at the replaced test", async () => {
    const path = "src/math.test.ts";
    const c = loadCase("block-each-dissimilar");
    const { target, fresh } = await shapeOf(c, path);
    const each = fresh.filter((h) => h.modifiers.includes("each") && groupOf(h) === groupOf(target));
    expect(each.length, "an .each test is added in the same describe").toBeGreaterThan(0);
    const was = subjects(target.body);
    expect(was.size, "the replaced test calls a function inside expect(").toBeGreaterThan(0);
    for (const h of each) {
      expect(
        [...subjects(h.body)].some((s) => was.has(s)),
        "the .each test calls another function",
      ).toBe(false);
      expect(jaccard(words(leaf(h)), words(leaf(target))), "under a dissimilar name").toBeLessThan(0.5);
    }

    expectOneBlock(await runBlock(c), path, target);
  });

  it("AC-6: (e) a test deleted while another touched file adds a test of a similar name and an unrelated body gives one block TI02 at the deleted test", async () => {
    const path = "src/user.test.ts";
    const other = "src/account.test.ts";
    const c = loadCase("block-similar-name-elsewhere");
    const { target } = await shapeOf(c, path);
    expect(diffSection(c.diff, other), `${other} is added`).toMatch(/^new file mode/m);
    const added = await testsOf(c.head, other);
    const similar = added.filter((h) => jaccard(words(fullName(h)), words(fullName(target))) >= 0.5);
    expect(similar.length, "the added file holds a test of a similar name").toBeGreaterThan(0);
    for (const h of similar) {
      expect(leaf(h), "not the same leaf name").not.toBe(leaf(target));
      expect(h.bodyHash, "and an unrelated body").not.toBe(target.bodyHash);
    }

    expectOneBlock(await runBlock(c), path, target);
  });
});
