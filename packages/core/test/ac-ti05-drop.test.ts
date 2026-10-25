import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI05 and
// fixtures/test-integrity/TI05/ exist, so nothing that depends on them may run while the file loads. The fixtures are
// written by the build, so each test first checks, through the existing JS/TS test index, that its fixture holds the
// case the AC describes. A case that gives no TI05 must still have been compared: `languages` is `["ts"]`.

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
  bodyHash: string;
  assertionCount: number;
}
interface Report {
  testIntegrity: { signals: Signal[]; languages: string[] };
}
interface Pair {
  was: Block;
  now: Block;
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
const ti05Of = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI05");

/** The tests whose full name occurs once on each side, paired, keeping those `keep` selects. */
async function pairsOf(c: Case, keep: (pair: Pair) => boolean): Promise<Pair[]> {
  expect(c.diff).toContain(`--- a/${PATH}`);
  expect(c.diff).toContain(`+++ b/${PATH}`);
  const base = await testsOf(fileAt(c.base, PATH));
  const head = await testsOf(fileAt(c.head, PATH));
  return base.flatMap((was) => {
    const same = head.filter((h) => fullName(h) === fullName(was));
    const once = base.filter((b) => fullName(b) === fullName(was)).length === 1 && same.length === 1;
    return once && keep({ was, now: same[0] as Block }) ? [{ was, now: same[0] as Block }] : [];
  });
}

/** The body with every `expect(…)…;` statement taken out and whitespace collapsed: a reading of "the rest". */
const rest = (body: string) =>
  body
    .replace(/expect\s*\([^;]*;/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function expectNoTI05(c: Case, label: string) {
  const report = await runCase(c);
  expect(ti05Of(report), `${label}: no TI05`).toEqual([]);
  expect(report.testIntegrity.languages, `${label}: the file was compared`).toEqual(["ts"]);
}

describe("TI05: assertions dropped", () => {
  it("AC-9: one of three assertions removed with the rest of the body unchanged gives exactly one warn TI05", async () => {
    const c = loadCase("warn-one-removed");
    const pairs = await pairsOf(c, ({ was, now }) => was.assertionCount === 3 && now.assertionCount === 2);
    expect(pairs, "one test goes from three assertions to two").toHaveLength(1);
    const { was, now } = pairs[0] as Pair;
    expect(rest(now.body), "the rest of the body is unchanged").toBe(rest(was.body));

    const ti05 = ti05Of(await runCase(c));
    expect(ti05).toHaveLength(1);
    expect(ti05[0]?.severity).toBe("warn");
    expect(ti05[0]?.path).toBe(PATH);
    expect(ti05[0]?.line).toBe(now.line);
  });

  it("AC-9: one of three assertions removed together with a rewrite of the rest of the body gives no TI05", async () => {
    const c = loadCase("pass-removed-with-rewrite");
    const pairs = await pairsOf(c, ({ was, now }) => was.assertionCount === 3 && now.assertionCount === 2);
    expect(pairs, "one test goes from three assertions to two").toHaveLength(1);
    const { was, now } = pairs[0] as Pair;
    expect(rest(now.body), "the rest of the body was rewritten").not.toBe(rest(was.body));
    await expectNoTI05(c, "removed with a rewrite");
  });

  it("AC-9: assertions rewritten into fewer but equally strong ones in a rewritten body give no TI05", async () => {
    const c = loadCase("pass-fewer-rewritten");
    const pairs = await pairsOf(
      c,
      ({ was, now }) => now.assertionCount >= 1 && now.assertionCount < was.assertionCount,
    );
    expect(pairs, "one test keeps fewer assertions").toHaveLength(1);
    const { was, now } = pairs[0] as Pair;
    expect(rest(now.body), "in a rewritten body").not.toBe(rest(was.body));
    await expectNoTI05(c, "fewer, rewritten");
  });

  it("AC-9: an assertion count that grows gives no TI05", async () => {
    const c = loadCase("pass-count-grows");
    const pairs = await pairsOf(c, ({ was, now }) => now.assertionCount > was.assertionCount);
    expect(pairs.length, "a test gains an assertion").toBeGreaterThan(0);
    await expectNoTI05(c, "count grows");
  });

  for (const [name, modifier] of [
    ["pass-became-skip", "skip"],
    ["pass-became-todo", "todo"],
  ] as const) {
    it(`AC-9: a test with two assertions that becomes it.${modifier} with none gives no TI05`, async () => {
      const c = loadCase(name);
      const pairs = await pairsOf(
        c,
        ({ was, now }) => was.assertionCount === 2 && now.assertionCount === 0 && now.modifiers.includes(modifier),
      );
      expect(pairs, `one test becomes it.${modifier} with no assertion`).toHaveLength(1);
      expect((pairs[0] as Pair).was.modifiers).not.toContain(modifier);
      await expectNoTI05(c, `became ${modifier}`);
    });
  }

  it("AC-9: a test with no assertions at base that keeps none gives no TI05", async () => {
    const c = loadCase("pass-none-at-base");
    const pairs = await pairsOf(c, ({ was, now }) => was.assertionCount === 0 && now.assertionCount === 0);
    expect(pairs.length, "a test has no assertion on either side").toBeGreaterThan(0);
    await expectNoTI05(c, "none at base");
  });
});
