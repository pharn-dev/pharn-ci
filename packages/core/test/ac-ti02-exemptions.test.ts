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
  nameDynamic: boolean;
  path: string[];
  line: number;
  modifiers: string[];
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
const sorted = (list: string[]) => [...list].sort();

/** The SPEC's tokens: maximal runs of letters, digits, `_` and `$`, and each other non-space character. */
const tokens = (body: string) => new Set(body.match(/[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? []);
function jaccard(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 && y.size === 0) return 1;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

/** Load a same-file case and index both sides of src/cart.test.ts. */
async function sides(name: string) {
  const c = loadCase(name);
  expect(c.diff, `${name}: the diff modifies ${PATH}`).toContain(`--- a/${PATH}`);
  expect(c.diff, `${name}: the diff modifies ${PATH}`).toContain(`+++ b/${PATH}`);
  return { c, base: await testsOf(fileAt(c.base, PATH)), head: await testsOf(fileAt(c.head, PATH)) };
}

/** The base tests whose full name is gone at head, and the head tests whose full name is new. */
function changedNames(base: Block[], head: Block[]) {
  const headNames = new Set(head.map(fullName));
  const baseNames = new Set(base.map(fullName));
  return {
    gone: base.filter((b) => !headNames.has(fullName(b))),
    added: head.filter((h) => !baseNames.has(fullName(h))),
  };
}

async function expectNoTI02(c: Case, label: string) {
  const report = await runCase(c);
  expect(
    report.testIntegrity.signals.filter((s) => String(s.id) === "TI02"),
    `${label}: no TI02`,
  ).toEqual([]);
  expect(report.testIntegrity.languages, `${label}: the file was compared`).toEqual(["ts"]);
}

describe("TI02: renames, moves, rewrites and duplicates in the same file are not deletions", () => {
  it("AC-3: a test renamed with its body unchanged gives no TI02", async () => {
    const { c, base, head } = await sides("pass-renamed-same-body");
    const { gone, added } = changedNames(base, head);
    expect(gone).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(added[0]?.bodyHash, "the body is unchanged").toBe(gone[0]?.bodyHash);
    await expectNoTI02(c, "renamed, same body");
  });

  it("AC-3: a test renamed with one changed literal in its body (token-set Jaccard at least 0.8) gives no TI02", async () => {
    const { c, base, head } = await sides("pass-renamed-edited-literal");
    const { gone, added } = changedNames(base, head);
    expect(gone).toHaveLength(1);
    expect(added).toHaveLength(1);
    const [was, now] = [gone[0] as Block, added[0] as Block];
    expect(now.bodyHash, "the body changed").not.toBe(was.bodyHash);
    expect(jaccard(was.body, now.body), "the bodies are similar").toBeGreaterThanOrEqual(0.8);
    await expectNoTI02(c, "renamed, one literal edited");
  });

  it("AC-3: an enclosing describe renamed with its tests unchanged gives no TI02", async () => {
    const { c, base, head } = await sides("pass-describe-renamed");
    const { gone } = changedNames(base, head);
    expect(gone.length, "full names changed").toBeGreaterThan(0);
    expect(
      gone.every((b) => b.path.length > 1),
      "the renamed tests sit inside a describe",
    ).toBe(true);
    const leafAndBody = (blocks: Block[]) => sorted(blocks.map((b) => `${leaf(b)}#${b.bodyHash}`));
    expect(leafAndBody(head), "the tests are unchanged").toEqual(leafAndBody(base));
    await expectNoTI02(c, "describe renamed");
  });

  it("AC-3: a test moved to another line of the same file gives no TI02", async () => {
    const { c, base, head } = await sides("pass-moved-in-file");
    expect(sorted(head.map((b) => `${fullName(b)}#${b.bodyHash}`))).toEqual(
      sorted(base.map((b) => `${fullName(b)}#${b.bodyHash}`)),
    );
    const order = (blocks: Block[]) => [...blocks].sort((a, b) => a.line - b.line).map(fullName);
    expect(order(head), "the test order changed").not.toEqual(order(base));
    await expectNoTI02(c, "moved in the file");
  });

  it("AC-3: a test whose body is rewritten with its name kept gives no TI02", async () => {
    const { c, base, head } = await sides("pass-body-rewritten");
    expect(sorted(head.map(fullName))).toEqual(sorted(base.map(fullName)));
    const rewritten = base.filter((b) => head.some((h) => fullName(h) === fullName(b) && h.bodyHash !== b.bodyHash));
    expect(rewritten.length, "a body was rewritten").toBeGreaterThan(0);
    await expectNoTI02(c, "body rewritten");
  });

  it("AC-3: a test that becomes it.todo with the same name gives no TI02", async () => {
    const { c, base, head } = await sides("pass-became-todo");
    expect(sorted(head.map(fullName))).toEqual(sorted(base.map(fullName)));
    const todo = head.filter((h) => h.modifiers.includes("todo"));
    expect(todo.length, "a head test is a todo").toBeGreaterThan(0);
    for (const t of todo) {
      const was = base.find((b) => fullName(b) === fullName(t));
      expect(was?.modifiers ?? [], "it was not a todo at base").not.toContain("todo");
    }
    await expectNoTI02(c, "became todo");
  });

  it("AC-3: a file with two tests named works that keeps both gives no TI02", async () => {
    const { c, base, head } = await sides("pass-two-works-kept");
    const works = (blocks: Block[]) => blocks.filter((b) => leaf(b) === "works");
    expect(works(base), "two works at base").toHaveLength(2);
    expect(works(head), "two works at head").toHaveLength(2);
    expect(new Set(works(base).map(fullName)).size, "the same full name twice").toBe(1);
    expect(sorted(works(head).map(fullName))).toEqual(sorted(works(base).map(fullName)));
    await expectNoTI02(c, "two works kept");
  });
});
