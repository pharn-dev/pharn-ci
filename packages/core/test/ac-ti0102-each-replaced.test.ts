import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixture are loaded inside the test body: the AC test is written before the `.each`
// replacement rule and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run while the
// file loads. The fixture is written by the build, so the test first checks, through the existing JS/TS test index,
// that it holds the case: one hand-written test of many expect(f(x)).toBe(…) lines replaced, in the same describe, by
// an it.each table that calls the same function with the same matcher.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/round.test.ts";
/** The dotted callee called first inside `expect(`, after an optional `await`. */
const SUBJECT = /expect\(\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;

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
  modifiers: string[];
  assertionCount: number;
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
const groupOf = (b: Block) => JSON.stringify(b.path.slice(0, -1));
const subjects = (body: string) => new Set([...body.matchAll(SUBJECT)].map((m) => m[1] as string));
const chains = (b: Block) => new Set(b.assertions.map((a) => a.chain));

describe("TI02 precision: hand-written tests replaced by an it.each table", () => {
  it("AC-3: one test of many expect(f(x)).toBe(…) replaced by an it.each table calling f with toBe gives no TI02, TI05, TI06 or TI07 and lists the .each test once, as renamed", async () => {
    const root = `${FIXTURES}test-integrity-precision/TI02/pass-each-replaced/`;
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);

    expect(diff).toContain(`--- a/${PATH}`);
    expect(diff).toContain(`+++ b/${PATH}`);
    expect(diff).not.toMatch(/^(new|deleted) file mode/m);
    const baseTests = await testsOf(base, PATH);
    const headTests = await testsOf(head, PATH);
    const headNames = new Set(headTests.map(fullName));
    const baseNames = new Set(baseTests.map(fullName));
    const gone = baseTests.filter((b) => !headNames.has(fullName(b)));
    const fresh = headTests.filter((h) => !baseNames.has(fullName(h)));
    expect(gone, "one hand-written test is gone").toHaveLength(1);
    expect(fresh, "one test is new").toHaveLength(1);
    const was = gone[0] as Block;
    const now = fresh[0] as Block;
    expect(now.modifiers, "the new test is an .each test").toContain("each");
    expect(was.modifiers).not.toContain("each");
    expect(groupOf(now), "in the same describe").toBe(groupOf(was));
    expect(was.assertionCount, "the base test holds many assertions").toBeGreaterThanOrEqual(3);
    expect(
      was.assertions.every((a) => /\.toBe\(\)$/.test(a.chain)),
      "every one of them a toBe",
    ).toBe(true);
    const wasSubjects = subjects(was.body);
    expect(wasSubjects.size, "the base test calls one function inside expect(").toBe(1);
    const nowSubjects = subjects(now.body);
    expect(
      [...wasSubjects].every((s) => nowSubjects.has(s)),
      "the .each test calls the same function",
    ).toBe(true);
    expect(
      [...chains(was)].every((chain) => chains(now).has(chain)),
      "with the same matcher",
    ).toBe(true);

    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...new Set([...head.map((f) => f.path), "src/round.ts"])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const ids = report.testIntegrity.signals.map((s) => String(s.id));
    for (const id of ["TI02", "TI05", "TI06", "TI07"]) expect(ids, `no ${id} signal`).not.toContain(id);
    expect(report.testIntegrity.languages, "the file was compared").toEqual(["ts"]);

    const changes = report.testIntegrity.changes;
    expect(changes, "testIntegrity.changes is present").toBeDefined();
    const entry = { path: PATH, name: fullName(now), line: now.line };
    const isEach = (e: Entry) => e.path === PATH && e.name === entry.name;
    expect(changes?.renamed.filter(isEach), "the .each test is listed once, under renamed").toEqual([entry]);
    for (const list of ["added", "removed", "modified"] as const) {
      expect(changes?.[list].filter(isEach), `and not under ${list}`).toEqual([]);
    }
  });
});
