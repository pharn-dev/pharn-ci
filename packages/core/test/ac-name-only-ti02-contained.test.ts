import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), matchTests, the test index, the body-token and name-word helpers and the fixture are loaded inside the test
// body: the AC test is written before the build writes fixtures/test-integrity-precision/TI02/pass-leaf-contained-deeper,
// so nothing that depends on it may run while the file loads. The test first checks, through the existing helpers, that
// the fixture holds the case the phase-2 leaf pick must still clear by body evidence: a test leaves src/a.test.ts for the
// touched test/checkout/b.test.ts under the same leaf name in a different, deeper group; its body grew, so the body hash
// differs and the body-token Jaccard is below 4/5, while the new body holds at least 4/5 of the old distinct tokens and
// every assertion chain; and the full-name words Jaccard is below 1/2, so the cross-file similarity rule cannot clear it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const A = "src/a.test.ts";
const B = "test/checkout/b.test.ts";

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
  name: string;
  path: string[];
  line: number;
  body: string;
  bodyHash: string;
  assertionCount: number;
  assertions: { chain: string }[];
}
interface Pair {
  basePath: string;
  headPath: string;
  base: Block;
  head: Block;
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

function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

const fullName = (b: Block) => b.path.join(" › ");
const leaf = (b: Block) => b.path[b.path.length - 1] ?? "";
const groups = (b: Block) => b.path.slice(0, -1).join(" › ");
const count = (blocks: Block[], name: string) => blocks.filter((b) => fullName(b) === name).length;

describe("TI02 phase 2: a same-leaf move whose body is held is still cleared", () => {
  it("AC-7: a test moved from src/a.test.ts to a deeper group of test/checkout/b.test.ts under the same leaf name, its grown body holding 4/5 of the old tokens and every assertion chain, gives no TI02 and is in matchTests(...).moved paired with the new test", async () => {
    const root = `${FIXTURES}test-integrity-precision/TI02/pass-leaf-contained-deeper/`;
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);
    expect(diffSection(diff, A), `${A} is modified`).not.toMatch(/^(new|deleted) file mode/m);
    expect(diff, `${B} is touched`).toContain(`+++ b/${B}`);

    const tokens = (await import("../src/signals/bodyTokens.js")) as unknown as {
      bodyTokenSet(body: string): Set<string>;
      jaccardAtLeast(a: ReadonlySet<string>, b: ReadonlySet<string>, ratio?: { num: number; den: number }): boolean;
      containsAtLeast(
        old: ReadonlySet<string>,
        fresh: ReadonlySet<string>,
        ratio: { num: number; den: number },
      ): boolean;
      FOUR_FIFTHS: { num: number; den: number };
      HALF: { num: number; den: number };
    };
    const subjects = (await import("../src/signals/testSubjects.js")) as unknown as {
      assertionChains(block: Block): Set<string>;
      holdsEveryChain(base: ReadonlySet<string>, head: ReadonlySet<string>): boolean;
    };
    const words = (await import("../src/signals/nameWords.js")) as unknown as {
      fullNameWords(block: Block): Set<string>;
    };

    const aBase = await testsOf(base, A);
    const aHead = await testsOf(head, A);
    const removed = aBase.filter((b) => count(aHead, fullName(b)) < count(aBase, fullName(b)));
    expect(removed, "one test leaves a.test.ts").toHaveLength(1);
    const was = removed[0] as Block;
    expect(was.assertionCount, "it asserts").toBeGreaterThan(0);

    const bBase = await testsOf(base, B);
    const bHead = await testsOf(head, B);
    const fresh = bHead.filter((h) => leaf(h) === leaf(was) && count(bBase, fullName(h)) < count(bHead, fullName(h)));
    expect(fresh, `b.test.ts gains one "${leaf(was)}"`).toHaveLength(1);
    const now = fresh[0] as Block;
    expect(groups(now), "in a different group").not.toBe(groups(was));
    expect(now.path.length, "a deeper one").toBeGreaterThan(was.path.length);
    expect(now.bodyHash, "the body hash differs").not.toBe(was.bodyHash);
    const oldTokens = tokens.bodyTokenSet(was.body);
    const newTokens = tokens.bodyTokenSet(now.body);
    expect(tokens.jaccardAtLeast(oldTokens, newTokens, tokens.FOUR_FIFTHS), "the body Jaccard is below 4/5").toBe(
      false,
    );
    expect(tokens.containsAtLeast(oldTokens, newTokens, tokens.FOUR_FIFTHS), "the new body holds 4/5").toBe(true);
    expect(
      subjects.holdsEveryChain(subjects.assertionChains(was), subjects.assertionChains(now)),
      "and every assertion chain",
    ).toBe(true);
    expect(
      tokens.jaccardAtLeast(words.fullNameWords(was), words.fullNameWords(now), tokens.HALF),
      "the full-name words Jaccard is below 1/2",
    ).toBe(false);

    const { check } = await import("../src/check.js");
    const sources = { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
      testSources: sources,
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);
    expect(report.testIntegrity.signals.filter((s) => String(s.id) === "TI02")).toEqual([]);
    expect(report.testIntegrity.languages, "the files were compared").toEqual(["ts"]);

    const core = (await import("@pharn-ci/core")) as unknown as { parseUnifiedDiff(text: string): unknown[] };
    const pairs = (await import("../src/signals/testPairs.js")) as unknown as {
      indexTouchedTestFiles(diff: unknown[], sources: unknown, pyIndex: unknown): unknown;
    };
    const match = (await import("../src/signals/testMatch.js")) as unknown as {
      matchTests(touched: unknown): { moved?: Pair[] };
    };
    const touched = pairs.indexTouchedTestFiles(core.parseUnifiedDiff(diff), sources, undefined);
    const moved = match.matchTests(touched).moved ?? [];
    expect(
      moved.map((p) => `${p.basePath} › ${fullName(p.base)} -> ${p.headPath} › ${fullName(p.head)}`),
      "the base test is moved, paired with the new test",
    ).toContain(`${A} › ${fullName(was)} -> ${B} › ${fullName(now)}`);
  });
});
