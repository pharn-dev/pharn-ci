import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixture are loaded inside the test body: the AC test is written before TI06 and
// fixtures/test-integrity/TI06/ exist, so nothing that depends on them may run while the file loads. The fixture is
// written by the build, so the test first checks, through the existing JS/TS test index, that the two changed tests
// hold exactly the changes the AC describes, and derives their head lines from the fixture text.

const REPO_ROOT = "/home/runner/work/demo/demo";
const MATCHER = "toBe → toBeTruthy";
const GUARD = "expect.hasAssertions removed";
const TAUTOLOGY = "an assertion that compares a literal with itself was added";

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
  assertions: { chain: string }[];
  guards: { kind: string; count: number | null }[];
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
/** The matcher of an `expect…` chain: the last `.name` before the final `()`. */
const matcherOf = (chain: string) => /\.([A-Za-z]+)\(\)$/.exec(chain)?.[1] ?? chain;
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("TI06: every reason of a test joined into one finding, labels sorted and cut at five", () => {
  it("AC-5: a test with a downgrade, a removed guard and a tautology gives one TI06 with the three reasons in order, a test with six strong matchers become six weak gives one TI06 naming five per side and 'and 1 more' twice, every detail at most 300 code units", async () => {
    const c = loadCase("warn-joined");
    expect(c.head, "one test file at head").toHaveLength(1);
    const path = (c.head[0] as SourceFile).path;
    expect(path).toMatch(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/);
    expect(c.diff).toContain(`--- a/${path}`);
    const base = await testsOf(c.base.find((f) => f.path === path));
    const head = await testsOf(c.head[0]);
    const pairs = head.flatMap((now) => {
      const was = base.filter((b) => fullName(b) === fullName(now));
      return was.length === 1 && (was[0] as Block).bodyHash !== now.bodyHash ? [{ was: was[0] as Block, now }] : [];
    });
    expect(pairs, "exactly two tests change").toHaveLength(2);
    for (const { now } of pairs)
      for (const m of ["skip", "todo", "skipIf", "runIf"]) expect(now.modifiers).not.toContain(m);

    // The first test: toBe(5) and toBe(6) become toBeTruthy(), expect.hasAssertions() goes, expect(true).toBe(true) comes.
    const first = pairs.find(({ was }) => was.guards.some((g) => g.kind === "hasAssertions"));
    expect(first, "the test that loses expect.hasAssertions()").toBeDefined();
    const { was: firstWas, now: firstNow } = first as { was: Block; now: Block };
    expect(count(firstWas.body, ".toBe(5)")).toBe(1);
    expect(count(firstWas.body, ".toBe(6)")).toBe(1);
    expect(count(firstNow.body, ".toBe(5)")).toBe(0);
    expect(count(firstNow.body, ".toBe(6)")).toBe(0);
    expect(count(firstNow.body, ".toBeTruthy()") - count(firstWas.body, ".toBeTruthy()")).toBe(2);
    expect(firstNow.guards, "no guard left").toEqual([]);
    expect(count(firstWas.body, "expect(true).toBe(true);")).toBe(0);
    expect(count(firstNow.body, "expect(true).toBe(true);")).toBe(1);

    // The second test: six assertions with six strong matchers become six with six weak ones.
    const second = pairs.find((p) => p !== first) as { was: Block; now: Block };
    expect(second.was.assertions.map((a) => matcherOf(a.chain)).sort()).toEqual([
      "toBe",
      "toContain",
      "toEqual",
      "toHaveLength",
      "toMatch",
      "toStrictEqual",
    ]);
    expect(second.now.assertions.map((a) => matcherOf(a.chain)).sort()).toEqual([
      "toBeCalled",
      "toBeDefined",
      "toBeFalsy",
      "toBeTruthy",
      "toBeTypeOf",
      "toHaveBeenCalled",
    ]);

    const report = await runBlock(c);
    const ti06 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
    expect(ti06, "one TI06 per test").toHaveLength(2);
    for (const signal of ti06) {
      expect(signal.path).toBe(path);
      expect(signal.severity).toBe("warn");
      expect(signal.detail.length, "at most 300 UTF-16 code units").toBeLessThanOrEqual(300);
    }

    const firstSignal = ti06.find((s) => s.line === firstNow.line);
    expect(firstSignal, "the first test's TI06 at its head line").toBeDefined();
    const one = (firstSignal as Signal).detail;
    expect(one).toContain(MATCHER);
    expect(one).toContain(GUARD);
    expect(one).toContain(TAUTOLOGY);
    expect(one.indexOf(MATCHER), "the matcher reason first").toBeLessThan(one.indexOf(GUARD));
    expect(one.indexOf(GUARD), "then the guard reason").toBeLessThan(one.indexOf(TAUTOLOGY));

    const secondSignal = ti06.find((s) => s.line === second.now.line);
    expect(secondSignal, "the second test's TI06 at its head line").toBeDefined();
    const two = (secondSignal as Signal).detail;
    for (const label of [
      "toBe",
      "toContain",
      "toEqual",
      "toHaveLength",
      "toMatch",
      "toBeCalled",
      "toBeDefined",
      "toBeFalsy",
      "toBeTruthy",
      "toBeTypeOf",
    ]) {
      expect(two, label).toContain(label);
    }
    expect(two).not.toContain("toStrictEqual");
    expect(two).not.toContain("toHaveBeenCalled");
    expect(occurrences(two, "and 1 more"), "one cut per side").toBe(2);
  });
});
