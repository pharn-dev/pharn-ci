import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixture are loaded inside the test body: the AC test is written before the TI01
// moved-names rule and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run while the
// file loads. The fixture is written by the build, so the test first checks, through the existing JS/TS test index,
// that it holds the case: six deleted test files whose every test name and describe name reappears among new tests
// with an assertion in the test files the change adds or modifies (corpus pattern: tests moved from test/ to src/).

const REPO_ROOT = "/home/runner/work/demo/demo";
const DELETED = ["parse", "format", "load", "save", "merge", "split"].map((n) => `test/${n}.test.ts`);
const MODIFIED = "src/core.test.ts";
const ADDED = ["src/text/text-ops.test.ts", "src/io/io-ops.test.ts"];
const MOVED_DETAIL =
  "Test file deleted; every test it held is found again, by name and body, in another test file of this change.";

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
  assertionCount: number;
}
interface Report {
  testIntegrity: { verdict: string; signals: Signal[]; languages: string[] };
  messages: { code: string; level: string; text: string }[];
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
const groups = (b: Block) => b.path.slice(0, -1);

function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

describe("TI01 precision: deleted test files whose tests reappear under the same names", () => {
  it("AC-8: six deleted test files whose every test and describe name is added, with assertions, in other touched test files are six info TI01 signals with the moved detail, no TI02 for them, and an info TEST_INTEGRITY_TI01 message", async () => {
    const root = `${FIXTURES}test-integrity-precision/TI01/info-moved-names/`;
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);

    for (const path of DELETED) {
      expect(diffSection(diff, path), `${path} is deleted`).toMatch(/^deleted file mode/m);
      expect(
        head.some((f) => f.path === path),
        `${path} has no head text`,
      ).toBe(false);
    }
    expect(diffSection(diff, MODIFIED), `${MODIFIED} is modified`).not.toMatch(/^(new|deleted) file mode/m);
    for (const path of ADDED) expect(diffSection(diff, path), `${path} is added`).toMatch(/^new file mode/m);

    // The new-at-head tests with at least one assertion: every test of an added file, and the tests of the modified
    // file whose full name is not at base.
    const modifiedBase = new Set((await testsOf(base, MODIFIED)).map(fullName));
    const fresh = [
      ...(await testsOf(head, MODIFIED)).filter((h) => !modifiedBase.has(fullName(h))),
      ...(await Promise.all(ADDED.map((path) => testsOf(head, path)))).flat(),
    ].filter((h) => h.assertionCount >= 1);
    const freshLeaves = new Set(fresh.map(leaf));
    const freshGroups = new Set(fresh.flatMap(groups));
    for (const path of DELETED) {
      const tests = await testsOf(base, path);
      expect(tests.length, `${path} held tests`).toBeGreaterThan(0);
      for (const t of tests) {
        expect(freshLeaves.has(leaf(t)), `${path}: "${leaf(t)}" reappears with an assertion`).toBe(true);
        for (const g of groups(t)) expect(freshGroups.has(g), `${path}: group "${g}" reappears`).toBe(true);
      }
    }

    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...new Set([...head.map((f) => f.path), "src/core.ts"])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01");
    for (const path of DELETED) {
      const mine = ti01.filter((s) => s.path === path);
      expect(mine, `${path}: one TI01 signal`).toHaveLength(1);
      expect(mine[0]?.severity).toBe("info");
      expect(mine[0]?.detail).toBe(MOVED_DETAIL);
    }
    const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
    expect(
      ti02.filter((s) => DELETED.includes(s.path)),
      "no TI02 for the deleted files",
    ).toEqual([]);
    const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI01");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("info");
  });
});
