import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI06 and
// fixtures/test-integrity/TI06/ exist, so nothing that depends on them may run while the file loads. Each fixture is
// written by the build, so each test first checks that it holds the case the AC describes; and each test checks that
// detectTI06 exists, so "no TI06" means TI06 ran and did not fire.

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
interface Assertion {
  chain: string;
  inTryCatch: boolean;
}
interface Block {
  kind: string;
  name: string;
  path: string[];
  line: number;
  modifiers: string[];
  body: string;
  bodyHash: string;
  assertions: Assertion[];
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
const count = (text: string, part: string) => squash(text).split(squash(part)).length - 1;
const MODIFIED = (path: string) => [`--- a/${path}`, `+++ b/${path}`];

/** The one test of the one modified file `path` whose body changed between base and head. */
async function changedTest(c: Case, path = "src/cart.test.ts"): Promise<{ was: Block; now: Block }> {
  for (const line of MODIFIED(path)) expect(c.diff).toContain(line);
  const base = await testsOf(c.base.find((f) => f.path === path));
  const head = await testsOf(c.head.find((f) => f.path === path));
  const changed = head.flatMap((now) => {
    const was = base.filter((b) => fullName(b) === fullName(now));
    return was.length === 1 && (was[0] as Block).bodyHash !== now.bodyHash ? [{ was: was[0] as Block, now }] : [];
  });
  expect(changed, "exactly one test changes").toHaveLength(1);
  return changed[0] as { was: Block; now: Block };
}

/** The base form `from` is gone from the changed test and the head form `to` is in its place. */
async function replaced(c: Case, from: string, to: string): Promise<{ was: Block; now: Block }> {
  const pair = await changedTest(c);
  expect(count(pair.was.body, from), `base holds ${from}`).toBeGreaterThan(0);
  expect(count(pair.now.body, from), `head no longer holds ${from}`).toBe(0);
  expect(count(pair.now.body, to), `head holds ${to}`).toBeGreaterThan(0);
  return pair;
}

/** Each case: the check the fixture must pass to be the AC's case. */
const CASES: ReadonlyArray<{ name: string; title: string; holds(c: Case): Promise<void> }> = [
  {
    name: "pass-strict-equal",
    title: "toEqual becoming toStrictEqual",
    holds: async (c) => {
      await replaced(c, ".toEqual(", ".toStrictEqual(");
    },
  },
  {
    name: "pass-tobe-toequal",
    title: "toBe becoming toEqual",
    holds: async (c) => {
      await replaced(c, ".toBe(", ".toEqual(");
    },
  },
  {
    name: "pass-truthy-beside",
    title: "a toBe assertion kept and a toBeTruthy assertion added beside it",
    holds: async (c) => {
      const { was, now } = await changedTest(c);
      expect(count(now.body, ".toBe(")).toBe(count(was.body, ".toBe("));
      expect(count(now.body, ".toBe(")).toBeGreaterThan(0);
      expect(count(now.body, ".toBeTruthy()") - count(was.body, ".toBeTruthy()")).toBe(1);
      expect(now.assertions.length - was.assertions.length).toBe(1);
    },
  },
  {
    name: "pass-added-tests",
    title: "a test the PR adds to a modified file and a test in an added test file, both using only toBeTruthy",
    holds: async (c) => {
      for (const line of MODIFIED("src/cart.test.ts")) expect(c.diff).toContain(line);
      const added = c.head.find((f) => f.path !== "src/cart.test.ts");
      expect(added, "an added test file at head").toBeDefined();
      expect(c.diff).toContain(`+++ b/${(added as SourceFile).path}`);
      expect(c.diff).toContain(`--- /dev/null\n+++ b/${(added as SourceFile).path}\n`);
      expect(c.base.map((f) => f.path)).not.toContain((added as SourceFile).path);
      const base = await testsOf(c.base.find((f) => f.path === "src/cart.test.ts"));
      const head = await testsOf(c.head.find((f) => f.path === "src/cart.test.ts"));
      const kept = new Map(base.map((b) => [fullName(b), b.bodyHash]));
      const newTests = head.filter((h) => !kept.has(fullName(h)));
      expect(newTests, "one test added to the modified file").toHaveLength(1);
      for (const h of head.filter((t) => kept.has(fullName(t)))) expect(h.bodyHash).toBe(kept.get(fullName(h)));
      const inAdded = await testsOf(added);
      expect(inAdded.length).toBeGreaterThan(0);
      for (const t of [...newTests, ...inAdded]) {
        expect(t.assertions.length, fullName(t)).toBeGreaterThan(0);
        for (const a of t.assertions) expect(a.chain, fullName(t)).toBe("expect().toBeTruthy()");
      }
    },
  },
  {
    name: "pass-tothrow-narrowed",
    title: "toThrow() becoming toThrow(TypeError)",
    holds: async (c) => {
      await replaced(c, ".toThrow()", ".toThrow(TypeError)");
    },
  },
  {
    name: "pass-guard-raised",
    title: "expect.assertions(1) becoming expect.assertions(2)",
    holds: async (c) => {
      const { was, now } = await replaced(c, "expect.assertions(1)", "expect.assertions(2)");
      expect(now.assertions.map((a) => a.chain).sort()).toEqual(was.assertions.map((a) => a.chain).sort());
    },
  },
  {
    name: "pass-try-kept",
    title: "an assertion already inside a try block with a catch at base staying there",
    holds: async (c) => {
      const { was, now } = await changedTest(c);
      expect(was.assertions.filter((a) => a.inTryCatch).length).toBeGreaterThan(0);
      expect(now.assertions.filter((a) => a.inTryCatch).length).toBe(was.assertions.filter((a) => a.inTryCatch).length);
      expect(now.assertions.filter((a) => !a.inTryCatch).length).toBe(
        was.assertions.filter((a) => !a.inTryCatch).length,
      );
    },
  },
  {
    name: "pass-became-skip",
    title: "a test whose toBe becomes toBeTruthy becoming a skipped test at head",
    holds: async (c) => {
      const { now } = await replaced(c, ".toBe(", ".toBeTruthy()");
      expect(now.modifiers, "skipped at head").toContain("skip");
    },
  },
  {
    name: "pass-neutral-matchers",
    title: "toBeNull() becoming toBeGreaterThan(0)",
    holds: async (c) => {
      await replaced(c, ".toBeNull()", ".toBeGreaterThan(0)");
    },
  },
  {
    name: "pass-chai",
    title: "a chai expect(x).to.equal(1) becoming expect(x).to.be.ok",
    holds: async (c) => {
      const { was, now } = await replaced(c, "expect(x).to.equal(1)", "expect(x).to.be.ok");
      expect(was.assertions.map((a) => a.chain)).toContain("expect().to.equal()");
      expect(now.assertions.map((a) => a.chain)).toContain("expect().to.be.ok");
    },
  },
  {
    name: "pass-cross-file",
    title:
      "a test with a toBe assertion removed from the modified src/a.test.ts and a same-leaf test using toBeTruthy added to the modified src/b.test.ts",
    holds: async (c) => {
      for (const path of ["src/a.test.ts", "src/b.test.ts"]) {
        for (const line of MODIFIED(path)) expect(c.diff).toContain(line);
      }
      const aBase = await testsOf(c.base.find((f) => f.path === "src/a.test.ts"));
      const aHead = await testsOf(c.head.find((f) => f.path === "src/a.test.ts"));
      const bBase = await testsOf(c.base.find((f) => f.path === "src/b.test.ts"));
      const bHead = await testsOf(c.head.find((f) => f.path === "src/b.test.ts"));
      const gone = aBase.filter((t) => !aHead.some((h) => fullName(h) === fullName(t)));
      expect(gone, "one test removed from src/a.test.ts").toHaveLength(1);
      const removed = gone[0] as Block;
      expect(count(removed.body, ".toBe(")).toBeGreaterThan(0);
      const came = bHead.filter((t) => !bBase.some((b) => fullName(b) === fullName(t)));
      expect(came, "one test added to src/b.test.ts").toHaveLength(1);
      const addedTest = came[0] as Block;
      expect(addedTest.name, "the same leaf name").toBe(removed.name);
      expect(count(addedTest.body, ".toBeTruthy()")).toBeGreaterThan(0);
      expect(count(addedTest.body, ".toBe(")).toBe(0);
      expect(squash(addedTest.body)).toBe(squash(removed.body).replace(/\.toBe\([^)]*\)/, ".toBeTruthy()"));
    },
  },
];

describe("TI06: changes that are not a weakening give no finding", () => {
  for (const { name, title, holds } of CASES) {
    it(`AC-7: ${title} gives no TI06`, async () => {
      const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
      expect(typeof core.detectTI06, "TI06 exists, so its absence here is the case's doing").toBe("function");
      const c = loadCase(name);
      await holds(c);
      const report = await runBlock(c);
      expect(report.testIntegrity.signals.filter((s) => String(s.id) === "TI06")).toEqual([]);
    });
  }
});
