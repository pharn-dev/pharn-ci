import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI06 and
// fixtures/test-integrity/TI06/ exist, so nothing that depends on them may run while the file loads. Each fixture is
// written by the build, so each test first checks, through the existing JS/TS test index, that one test of the case's
// one modified test file holds the strong form at base and the weak form at head, with the other tests unchanged.

const REPO_ROOT = "/home/runner/work/demo/demo";

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
  modifiers: string[];
  body: string;
  bodyHash: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
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
  const root = `${FIXTURES}test-integrity/TI06/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

const diffPaths = (diff: string) => [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1] as string);

async function runBlock(c: Case): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), ...diffPaths(c.diff)])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

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
const squash = (text: string) => text.replace(/\s+/g, "");

/**
 * The case's one modified JS/TS test file, and its one changed test: the base body holds `from`, the head body holds
 * `to` and not `from`, the test is not skipped at head, and every other test of the file is unchanged.
 */
async function changedTest(c: Case, from: string, to: string): Promise<{ path: string; now: Block }> {
  expect(c.head, "one test file at head").toHaveLength(1);
  const path = (c.head[0] as SourceFile).path;
  expect(path).toMatch(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/);
  expect(c.diff).toContain(`--- a/${path}`);
  expect(c.diff).toContain(`+++ b/${path}`);
  const base = await testsOf(c.base.find((f) => f.path === path));
  const head = await testsOf(c.head[0]);
  const changed = head.filter((now) => {
    const was = base.filter((b) => fullName(b) === fullName(now));
    return was.length === 1 && (was[0] as Block).bodyHash !== now.bodyHash;
  });
  expect(changed, "exactly one test changes").toHaveLength(1);
  const now = changed[0] as Block;
  const was = base.find((b) => fullName(b) === fullName(now)) as Block;
  expect(squash(was.body), "the base form").toContain(squash(from));
  expect(squash(now.body), "the head form").toContain(squash(to));
  expect(squash(now.body), "the base form is gone at head").not.toContain(squash(from));
  for (const m of ["skip", "todo", "skipIf", "runIf"]) expect(now.modifiers).not.toContain(m);
  expect(head.map(fullName).sort(), "the same tests at base and head").toEqual(base.map(fullName).sort());
  return { path, now };
}

const CASES: ReadonlyArray<{ name: string; from: string; to: string; label: string }> = [
  { name: "warn-toequal-defined", from: ".toEqual(cart)", to: ".toBeDefined()", label: "toEqual → toBeDefined" },
  { name: "warn-tothrow-bare", from: ".toThrow(TypeError)", to: ".toThrow()", label: "toThrow(error) → toThrow()" },
  {
    name: "warn-called-with",
    from: ".toHaveBeenCalledWith(item)",
    to: ".toHaveBeenCalled()",
    label: "toHaveBeenCalledWith → toHaveBeenCalled",
  },
  {
    name: "warn-null-not-undefined",
    from: ".toBe(null)",
    to: ".not.toBeUndefined()",
    label: "toBe → not.toBeUndefined",
  },
  {
    name: "warn-assert-ok",
    from: "assert.strictEqual(a, b)",
    to: "assert.ok(a)",
    label: "assert.strictEqual → assert.ok",
  },
  {
    name: "warn-soft-truthy",
    from: "expect.soft(x).toBe(1)",
    to: "expect.soft(x).toBeTruthy()",
    label: "toBe → toBeTruthy",
  },
  {
    name: "warn-property-instance",
    from: '.toHaveProperty("total", 5)',
    to: ".toBeInstanceOf(Object)",
    label: "toHaveProperty(key, value) → toBeInstanceOf(Object)",
  },
];

describe("TI06: the strong-to-weak matcher table", () => {
  for (const { name, from, to, label } of CASES) {
    it(`AC-2: ${from} becoming ${to} gives exactly one warn TI06 whose detail holds ${label}`, async () => {
      const c = loadCase(name);
      const { path, now } = await changedTest(c, from, to);
      const report = await runBlock(c);
      const ti06 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
      expect(ti06).toHaveLength(1);
      expect(ti06[0]?.severity).toBe("warn");
      expect(ti06[0]?.path).toBe(path);
      expect(ti06[0]?.line).toBe(now.line);
      expect(ti06[0]?.detail).toContain(label);
    });
  }
});
