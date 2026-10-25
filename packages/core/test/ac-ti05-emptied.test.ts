import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI05 and
// fixtures/test-integrity/TI05/ exist, so nothing that depends on them may run while the file loads. The fixtures are
// written by the build, so each test first checks, through the existing JS/TS test index, that its fixture holds the
// case the AC describes, and derives the expected head line and name from the fixture text.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

type Mode = "block" | "warn";
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
  modifiers: string[];
  body: string;
  bodyHash: string;
  assertionCount: number;
  guards: { kind: string; count: number | null }[];
}
interface Report {
  testIntegrity: { signals: Signal[]; languages: string[] };
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
  const root = `${FIXTURES}test-integrity/TI05/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

async function runCase(c: Case, mode: Mode): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: mode },
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
const fileAt = (files: SourceFile[], path: string) => files.find((f) => f.path === path);

/** The one test of the case that has two assertions at base and none at head, under the same full name. */
async function emptiedTest(c: Case): Promise<{ was: Block; now: Block }> {
  expect(c.diff).toContain(`--- a/${PATH}`);
  expect(c.diff).toContain(`+++ b/${PATH}`);
  const base = await testsOf(fileAt(c.base, PATH));
  const head = await testsOf(fileAt(c.head, PATH));
  const pairs = base.flatMap((was) => {
    const same = head.filter((h) => fullName(h) === fullName(was));
    return same.length === 1 && was.assertionCount === 2 && (same[0] as Block).assertionCount === 0
      ? [{ was, now: same[0] as Block }]
      : [];
  });
  expect(pairs, "exactly one test goes from two assertions to none").toHaveLength(1);
  const pair = pairs[0] as { was: Block; now: Block };
  for (const m of ["skip", "todo", "skipIf", "runIf"]) expect(pair.now.modifiers, "not skipped").not.toContain(m);
  return pair;
}

describe("TI05: a test emptied of its assertions", () => {
  for (const [mode, level] of [
    ["block", "error"],
    ["warn", "warn"],
  ] as const) {
    it(`AC-7: in mode ${mode} a test whose two expect assertions are gone, its head body calling only the code under test, gives one TI05 at its head line with its full name and a ${level} message`, async () => {
      const c = loadCase("block-emptied");
      const { now } = await emptiedTest(c);
      expect(now.guards, "no assertion guard left either").toEqual([]);
      expect(now.body.trim().length, "the head body still calls the code under test").toBeGreaterThan(0);

      const report = await runCase(c, mode);
      const ti05 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI05");
      expect(ti05).toHaveLength(1);
      expect(ti05[0]?.path).toBe(PATH);
      expect(ti05[0]?.line).toBe(now.line);
      expect(ti05[0]?.detail).toContain(fullName(now));
      expect(ti05[0]?.detail.length).toBeLessThanOrEqual(300);
      expect(ti05[0]?.severity).toBe(mode);
      const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI05");
      expect(messages).toHaveLength(1);
      expect(messages[0]?.level).toBe(level);
    });

    it(`AC-7: in mode ${mode} a test whose head body keeps only expect.assertions(1) gives one TI05 at its head line with its full name and a ${level} message`, async () => {
      const c = loadCase("block-guard-only");
      const { now } = await emptiedTest(c);
      expect(now.body).toContain("expect.assertions(1)");
      expect(now.guards.map((g) => g.kind)).toEqual(["assertions"]);

      const report = await runCase(c, mode);
      const ti05 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI05");
      expect(ti05).toHaveLength(1);
      expect(ti05[0]?.path).toBe(PATH);
      expect(ti05[0]?.line).toBe(now.line);
      expect(ti05[0]?.detail).toContain(fullName(now));
      expect(ti05[0]?.severity).toBe(mode);
      const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI05");
      expect(messages).toHaveLength(1);
      expect(messages[0]?.level).toBe(level);
    });
  }
});
