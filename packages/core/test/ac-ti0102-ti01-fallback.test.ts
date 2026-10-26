import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before the TI01
// moved-names rule and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run while the
// file loads. The fixtures are written by the build. Each case is the AC-8 shape with one thing taken away, so the
// moved-names rule must not apply and today's block (with today's detail) stays.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DELETED = ["parse", "format", "load", "save", "merge", "split"].map((n) => `test/${n}.test.ts`);
const MODIFIED = "src/core.test.ts";
const ADDED = ["src/text/text-ops.test.ts", "src/io/io-ops.test.ts"];
const TODAY = "Test file deleted; its removed lines defined tests.";

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
  assertionCount: number;
}
interface Report {
  testIntegrity: { verdict: string; signals: Signal[] };
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

function loadCase(name: string): Case {
  const root = `${FIXTURES}test-integrity-precision/TI01/${name}/`;
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
const leaf = (b: Block) => b.path[b.path.length - 1] ?? "";

function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

function expectShape(c: Case): void {
  for (const path of DELETED) expect(diffSection(c.diff, path), `${path} is deleted`).toMatch(/^deleted file mode/m);
  expect(diffSection(c.diff, MODIFIED), `${MODIFIED} is modified`).not.toMatch(/^(new|deleted) file mode/m);
  for (const path of ADDED) expect(diffSection(c.diff, path), `${path} is added`).toMatch(/^new file mode/m);
}

/** The new-at-head tests: every test of an added file and the tests of the modified file whose full name is new. */
async function freshTests(c: Case): Promise<Block[]> {
  const modifiedBase = new Set((await testsOf(c.base, MODIFIED)).map(fullName));
  return [
    ...(await testsOf(c.head, MODIFIED)).filter((h) => !modifiedBase.has(fullName(h))),
    ...(await Promise.all(ADDED.map((path) => testsOf(c.head, path)))).flat(),
  ];
}

async function run(c: Case, extra: Record<string, unknown>): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...ADDED, MODIFIED, "src/core.ts"])].sort(),
    testIntegrityMode: { input: "block" },
    ...extra,
  } as unknown as Parameters<typeof check>[0]) as unknown as Report;
  expectValidReport(report);
  return report;
}

const withSources = (c: Case) => ({
  testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
});

/** Each of `paths` is one TI01 block signal with today's detail; every deleted file has exactly one TI01 signal. */
function expectBlocked(report: Report, paths: readonly string[]): void {
  const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01");
  for (const path of DELETED)
    expect(
      ti01.filter((s) => s.path === path),
      `${path}: one TI01 signal`,
    ).toHaveLength(1);
  for (const path of paths) {
    const signal = ti01.find((s) => s.path === path);
    expect(signal?.severity, `${path} blocks`).toBe("block");
    expect(signal?.detail).toBe(TODAY);
  }
  expect(report.testIntegrity.verdict).toBe("fail");
}

describe("TI01 precision: the moved-names rule falls back to today's block", () => {
  it("AC-9: (a) a deleted test whose name appears in no other touched file keeps its deleted file a block TI01 with today's detail", async () => {
    const c = loadCase("block-name-missing");
    expectShape(c);
    const freshLeaves = new Set((await freshTests(c)).map(leaf));
    const missing: string[] = [];
    for (const path of DELETED) {
      const tests = await testsOf(c.base, path);
      expect(tests.length, `${path} held tests`).toBeGreaterThan(0);
      if (tests.some((t) => !freshLeaves.has(leaf(t)))) missing.push(path);
    }
    expect(missing.length, "a deleted test's name appears nowhere else").toBeGreaterThan(0);

    expectBlocked(await run(c, withSources(c)), missing);
  });

  it("AC-9: (b) reappearing tests with no assertion keep every deleted file a block TI01 with today's detail", async () => {
    const c = loadCase("block-no-assertions");
    expectShape(c);
    const fresh = await freshTests(c);
    const names = new Set<string>();
    for (const path of DELETED) for (const t of await testsOf(c.base, path)) names.add(leaf(t));
    const reappearing = fresh.filter((h) => names.has(leaf(h)));
    expect(reappearing.length, "the deleted names reappear").toBeGreaterThan(0);
    expect(
      reappearing.every((h) => h.assertionCount === 0),
      "with no assertion",
    ).toBe(true);

    expectBlocked(await run(c, withSources(c)), DELETED);
  });

  it("AC-9: (c) the AC-8 fixture with no test sources keeps every deleted file a block TI01 with today's detail", async () => {
    const c = loadCase("info-moved-names");
    expectShape(c);
    expectBlocked(await run(c, {}), DELETED);
  });

  it("AC-9: (d) the AC-8 fixture with the deleted files' base text listed as dropped keeps every deleted file a block TI01 with today's detail", async () => {
    const c = loadCase("info-moved-names");
    expectShape(c);
    for (const path of DELETED)
      expect(
        c.base.some((f) => f.path === path),
        `${path} has base text`,
      ).toBe(true);
    const testSources = {
      base: {
        files: c.base.filter((f) => !DELETED.includes(f.path)),
        dropped: DELETED.map((path) => ({ path, reason: "too-large" })),
      },
      head: { files: c.head, dropped: [] },
    };
    expectBlocked(await run(c, { testSources }), DELETED);
  });

  it("AC-9: (e) the AC-8 fixture with the head side of the test sources unavailable while a compared test file exists keeps every deleted file a block TI01 with today's detail", async () => {
    const c = loadCase("info-moved-names");
    expectShape(c);
    const testSources = {
      base: { files: c.base, dropped: [] },
      head: { unavailable: "git cat-file failed" },
    };
    expectBlocked(await run(c, { testSources }), DELETED);
  });
});
