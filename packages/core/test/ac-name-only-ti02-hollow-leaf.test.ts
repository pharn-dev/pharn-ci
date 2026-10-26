import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), matchTests, the test index and the fixture are loaded inside the test body: the AC test is written before
// the build writes fixtures/test-integrity-precision/TI02/block-hollow-same-leaf and before TI02's phase-2 leaf pick
// asks for body evidence, so nothing that depends on them may run while the file loads. The test first checks, through
// the existing JS/TS test index, that the fixture holds the case: the modified src/a.test.ts loses two tests with real
// assertions, and the modified src/b.test.ts gains, for each, a test with the same leaf name that it did not have at
// base: one whose body is `expect(true).toBe(true)`, one with no assertion. A same leaf name alone must not clear them.

const REPO_ROOT = "/home/runner/work/demo/demo";
const A = "src/a.test.ts";
const B = "src/b.test.ts";

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
  body: string;
  assertionCount: number;
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
const count = (blocks: Block[], name: string) => blocks.filter((b) => fullName(b) === name).length;

describe("TI02 phase 2: a same leaf name alone does not clear a removed test", () => {
  it("AC-6: two tests with real assertions removed from src/a.test.ts while src/b.test.ts gains same-leaf tests, one hollow and one with no assertion, are two TI02 blocks at their base lines, and matchTests(...).moved holds neither", async () => {
    const root = `${FIXTURES}test-integrity-precision/TI02/block-hollow-same-leaf/`;
    const c: Case = {
      diff: readFileSync(`${root}change.diff`, "utf8"),
      base: sideFiles(`${root}base`),
      head: sideFiles(`${root}head`),
    };
    expect(diffSection(c.diff, A), `${A} is modified`).not.toMatch(/^(new|deleted) file mode/m);
    expect(diffSection(c.diff, B), `${B} is modified`).not.toMatch(/^(new|deleted) file mode/m);

    const aBase = await testsOf(c.base, A);
    const aHead = await testsOf(c.head, A);
    const removed = aBase.filter((b) => count(aHead, fullName(b)) < count(aBase, fullName(b)));
    expect(removed, "two tests leave a.test.ts").toHaveLength(2);
    for (const r of removed) expect(r.assertionCount, `"${fullName(r)}" asserts for real`).toBeGreaterThan(0);
    for (const r of removed) expect(r.body, `"${fullName(r)}" is not hollow`).not.toContain("expect(true)");

    const bBase = await testsOf(c.base, B);
    const bHead = await testsOf(c.head, B);
    const gained = removed.map((r) => bHead.filter((h) => leaf(h) === leaf(r)));
    for (const [i, r] of removed.entries()) {
      expect(
        bBase.some((b) => leaf(b) === leaf(r)),
        `b.test.ts has no "${leaf(r)}" at base`,
      ).toBe(false);
      expect(gained[i], `b.test.ts gains one "${leaf(r)}"`).toHaveLength(1);
    }
    const counterparts = gained.map((g) => g[0] as Block);
    expect(
      counterparts.filter((h) => h.assertionCount > 0 && h.body.includes("expect(true).toBe(true)")),
      "one same-leaf counterpart is hollow",
    ).toHaveLength(1);
    expect(
      counterparts.filter((h) => h.assertionCount === 0),
      "and one has no assertion",
    ).toHaveLength(1);

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

    const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
    expect(ti02, "two TI02 signals").toHaveLength(2);
    for (const s of ti02) {
      expect(s.path).toBe(A);
      expect(s.severity).toBe("block");
    }
    expect(ti02.map((s) => s.line).sort(), "one per removed test, at its base line").toEqual(
      removed.map((r) => r.line).sort(),
    );

    const core = (await import("@pharn-ci/core")) as unknown as { parseUnifiedDiff(text: string): unknown[] };
    const pairs = (await import("../src/signals/testPairs.js")) as unknown as {
      indexTouchedTestFiles(diff: unknown[], sources: unknown, pyIndex: unknown): unknown;
    };
    const match = (await import("../src/signals/testMatch.js")) as unknown as {
      matchTests(touched: unknown): { moved?: Pair[] };
    };
    const touched = pairs.indexTouchedTestFiles(
      core.parseUnifiedDiff(c.diff),
      { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
      undefined,
    );
    const moved = match.matchTests(touched).moved;
    expect(Array.isArray(moved), "matchTests returns a moved list").toBe(true);
    for (const r of removed) {
      expect(
        (moved ?? []).filter((p) => p.basePath === A && fullName(p.base) === fullName(r)),
        `"${fullName(r)}" is not moved`,
      ).toEqual([]);
    }
  });
});
