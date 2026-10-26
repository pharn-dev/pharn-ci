import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before the
// cross-file similarity rule and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run
// while the file loads. The fixtures are written by the build, so each test first checks, through the existing JS/TS
// test index, that its fixture holds the case: a test moved to an added test file in another directory under a new
// name, which today's exact leaf-name and body-hash pass does not match.

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
interface Entry {
  path: string;
  name: string;
  line: number;
}
interface Block {
  kind: string;
  path: string[];
  line: number;
  body: string;
  bodyHash: string;
  assertions: { chain: string }[];
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
const leaf = (b: Block) => b.path[b.path.length - 1] ?? "";
const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
/** The words of a name as the SPEC defines them: the distinct lowercased runs of letters and digits. */
const words = (text: string) => new Set([...text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0]));
/** A rough token set of a normalized body, used here only to pick the head test a base test moved to. */
const tokens = (body: string) => new Set(body.match(/[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? []);
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

interface Moved {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
  was: Block;
  added: Block[];
}

/** Load a case where `from` (modified) loses one test and `to` (added, in another directory) holds new tests. */
async function loadMoved(name: string, from: string, to: string): Promise<Moved> {
  const root = `${FIXTURES}test-integrity-precision/TI02/${name}/`;
  const diff = readFileSync(`${root}change.diff`, "utf8");
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  expect(diffSection(diff, from), `${from} is modified`).not.toMatch(/^(new|deleted) file mode/m);
  expect(diffSection(diff, to), `${to} is added`).toMatch(/^new file mode/m);
  expect(
    base.some((f) => f.path === to),
    `${to} has no base text`,
  ).toBe(false);
  expect(dirOf(to), "the added file sits in another directory").not.toBe(dirOf(from));
  const fromBase = await testsOf(base, from);
  const fromHead = await testsOf(head, from);
  const headNames = new Set(fromHead.map(fullName));
  const gone = fromBase.filter((b) => !headNames.has(fullName(b)));
  expect(gone, `one test leaves ${from}`).toHaveLength(1);
  const was = gone[0] as Block;
  const added = await testsOf(head, to);
  expect(added.length, `${to} holds tests`).toBeGreaterThan(0);
  for (const h of added) {
    expect(leaf(h), "no added test keeps the leaf name").not.toBe(leaf(was));
    expect(h.bodyHash, "no added test keeps the exact body").not.toBe(was.bodyHash);
  }
  return { diff, base, head, was, added };
}

async function runMoved(m: Moved): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: m.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...m.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: m.base, dropped: [] }, head: { files: m.head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]) as unknown as Report;
  expectValidReport(report);
  return report;
}

function expectMoved(report: Report, to: string, now: Block): void {
  expect(report.testIntegrity.signals.filter((s) => String(s.id) === "TI02")).toEqual([]);
  expect(report.testIntegrity.languages, "the files were compared").toEqual(["ts"]);
  const changes = report.testIntegrity.changes;
  expect(changes, "testIntegrity.changes is present").toBeDefined();
  expect(changes?.renamed, "the moved test is listed as renamed at its head path").toContainEqual({
    path: to,
    name: fullName(now),
    line: now.line,
  });
}

describe("TI02 precision: a test moved to an added test file under a new name", () => {
  it("AC-4: a test moved to an added file in another directory with an almost identical body gives no TI02 and is listed as renamed at its head path", async () => {
    const from = "src/cart.test.ts";
    const to = "test/checkout/totals.test.ts";
    const m = await loadMoved("pass-moved-near-identical", from, to);
    const best = [...m.added].sort(
      (a, b) => jaccard(tokens(m.was.body), tokens(b.body)) - jaccard(tokens(m.was.body), tokens(a.body)),
    )[0] as Block;
    // A rough token set, not the signal's own: a loose bound that the fixture holds a near copy, not the threshold.
    expect(
      jaccard(tokens(m.was.body), tokens(best.body)),
      "the head body is almost the base body",
    ).toBeGreaterThanOrEqual(0.6);

    expectMoved(await runMoved(m), to, best);
  });

  it("AC-4: a test moved to an added file in another directory under a full name sharing half its words, with a contained body and every assertion chain, gives no TI02 and is listed as renamed at its head path", async () => {
    const from = "src/price.test.ts";
    const to = "test/pricing/discounts.test.ts";
    const m = await loadMoved("pass-moved-name-contained", from, to);
    const nameWords = words(fullName(m.was));
    const best = [...m.added].sort(
      (a, b) => jaccard(nameWords, words(fullName(b))) - jaccard(nameWords, words(fullName(a))),
    )[0] as Block;
    expect(
      jaccard(nameWords, words(fullName(best))),
      "the full names share at least half their words",
    ).toBeGreaterThanOrEqual(0.5);
    const wasTokens = tokens(m.was.body);
    const nowTokens = tokens(best.body);
    expect(
      [...wasTokens].filter((t) => nowTokens.has(t)).length / wasTokens.size,
      "the head body holds most of the base body's tokens (rough tokens, a loose bound)",
    ).toBeGreaterThanOrEqual(0.6);
    const nowChains = new Set(best.assertions.map((a) => a.chain));
    expect(m.was.assertions.length, "the base test has assertions").toBeGreaterThan(0);
    expect(
      m.was.assertions.every((a) => nowChains.has(a.chain)),
      "and the head test holds every chain",
    ).toBe(true);

    expectMoved(await runMoved(m), to, best);
  });
});
