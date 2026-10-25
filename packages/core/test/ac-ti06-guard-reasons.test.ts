import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI06 and
// fixtures/test-integrity/TI06/ exist, so nothing that depends on them may run while the file loads. Each fixture is
// written by the build, so each test first checks, through the existing JS/TS test index, that one test's guard is
// lowered or removed while its assertions stay the same, and that no path of the case holds a digit.

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
interface Guard {
  kind: string;
  count: number | null;
}
interface Block {
  kind: string;
  path: string[];
  line: number;
  modifiers: string[];
  bodyHash: string;
  assertions: { chain: string }[];
  guards: Guard[];
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
const guardsOf = (b: Block) => b.guards.map((g) => `${g.kind}(${g.count ?? ""})`).sort();

/**
 * The case's one modified JS/TS test file, whose path holds no digit, and its one changed test: its guards go from
 * `before` to `after` while its assertion chains stay the same.
 */
async function guardChange(c: Case, before: string[], after: string[]): Promise<{ path: string; now: Block }> {
  expect(c.head, "one test file at head").toHaveLength(1);
  const path = (c.head[0] as SourceFile).path;
  expect(path).toMatch(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/);
  for (const p of [...diffPaths(c.diff), ...c.base.map((f) => f.path), path]) {
    expect(p, "no path of the case holds a digit").not.toMatch(/[0-9]/);
  }
  expect(c.diff).toContain(`--- a/${path}`);
  const base = await testsOf(c.base.find((f) => f.path === path));
  const head = await testsOf(c.head[0]);
  const changed = head.filter((now) => {
    const was = base.filter((b) => fullName(b) === fullName(now));
    return was.length === 1 && (was[0] as Block).bodyHash !== now.bodyHash;
  });
  expect(changed, "exactly one test changes").toHaveLength(1);
  const now = changed[0] as Block;
  const was = base.find((b) => fullName(b) === fullName(now)) as Block;
  expect(guardsOf(was), "the base guards").toEqual(before);
  expect(guardsOf(now), "the head guards").toEqual(after);
  expect(now.assertions.length, "the test still asserts").toBeGreaterThan(0);
  expect(now.assertions.map((a) => a.chain).sort(), "the assertions are unchanged").toEqual(
    was.assertions.map((a) => a.chain).sort(),
  );
  for (const m of ["skip", "todo", "skipIf", "runIf"]) expect(now.modifiers).not.toContain(m);
  return { path, now };
}

const CASES: ReadonlyArray<{ name: string; title: string; before: string[]; after: string[]; text: string }> = [
  {
    name: "warn-guard-lowered",
    title: "expect.assertions(2) becoming expect.assertions(1)",
    before: ["assertions(2)"],
    after: ["assertions(1)"],
    text: "expect.assertions lowered",
  },
  {
    name: "warn-guard-removed",
    title: "expect.assertions(1) removed",
    before: ["assertions(1)"],
    after: [],
    text: "expect.assertions removed",
  },
  {
    name: "warn-has-assertions-removed",
    title: "expect.hasAssertions() removed",
    before: ["hasAssertions()"],
    after: [],
    text: "expect.hasAssertions removed",
  },
];

describe("TI06: an assertion guard lowered or removed", () => {
  for (const { name, title, before, after, text } of CASES) {
    it(`AC-3: ${title} with the assertions unchanged gives exactly one warn TI06 whose detail holds ${text} and no 1 or 2`, async () => {
      const c = loadCase(name);
      const { path, now } = await guardChange(c, before, after);
      const report = await runBlock(c);
      const ti06 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
      expect(ti06).toHaveLength(1);
      const signal = ti06[0] as Signal;
      expect(signal.severity).toBe("warn");
      expect(signal.path).toBe(path);
      expect(signal.line).toBe(now.line);
      expect(signal.detail).toContain(text);
      expect(signal.detail).not.toContain("1");
      expect(signal.detail).not.toContain("2");
    });
  }
});
