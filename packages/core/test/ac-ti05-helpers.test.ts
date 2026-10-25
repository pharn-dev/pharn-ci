import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI05 and
// fixtures/test-integrity/TI05/ exist, so nothing that depends on them may run while the file loads. The fixtures are
// written by the build, so each test first checks, through the existing JS/TS test index, that its fixture holds the
// case the AC describes.

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
  path: string[];
  line: number;
  modifiers: string[];
  body: string;
  assertionCount: number;
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
  const root = `${FIXTURES}test-integrity/TI05/${name}/`;
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
const fileAt = (files: SourceFile[], path: string) => files.find((f) => f.path === path);

const CASES: ReadonlyArray<[name: string, call: string]> = [
  ["warn-helper-expect", "expectValidCart(cart)"],
  ["warn-helper-assert", "assertTotal(cart, 5)"],
  ["warn-helper-check", "checkInvariants(cart)"],
  ["warn-helper-this-verify", "this.verifyState()"],
];

describe("TI05: assertions replaced by a call to an assertion helper", () => {
  for (const [name, call] of CASES) {
    it(`AC-8: a test whose assertions fall from two to zero, its head body calling ${call}, gives exactly one warn TI05 in mode block`, async () => {
      const c = loadCase(name);
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
      const now = (pairs[0] as { now: Block }).now;
      expect(now.body, `the head body calls ${call}`).toContain(call);
      for (const m of ["skip", "todo", "skipIf", "runIf"]) expect(now.modifiers, "not skipped").not.toContain(m);

      const report = await runCase(c);
      const ti05 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI05");
      expect(ti05).toHaveLength(1);
      expect(ti05[0]?.severity).toBe("warn");
      expect(ti05[0]?.path).toBe(PATH);
      expect(ti05[0]?.line).toBe(now.line);
    });
  }
});
