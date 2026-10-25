import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI02 and
// fixtures/test-integrity/TI02/ exist, so nothing that depends on them may run while the file loads. The fixtures are
// written by the build, so each test first checks, through the existing JS/TS test index, that its fixture holds the
// case the AC describes. A case that gives no TI02 must still have been compared: `languages` is `["ts"]`.

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
  nameDynamic: boolean;
  path: string[];
  line: number;
  modifiers: string[];
  body: string;
  bodyHash: string;
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
  const root = `${FIXTURES}test-integrity/TI02/${name}/`;
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

const fileAt = (files: SourceFile[], path: string) => files.find((f) => f.path === path);
const ti02Of = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");

/** The SPEC's tokens: maximal runs of letters, digits, `_` and `$`, and each other non-space character. */
const tokens = (body: string) => new Set(body.match(/[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? []);
function jaccard(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 && y.size === 0) return 1;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

async function sides(name: string) {
  const c = loadCase(name);
  expect(c.diff, `${name}: the diff modifies ${PATH}`).toContain(`--- a/${PATH}`);
  expect(c.diff, `${name}: the diff modifies ${PATH}`).toContain(`+++ b/${PATH}`);
  return { c, base: await testsOf(fileAt(c.base, PATH)), head: await testsOf(fileAt(c.head, PATH)) };
}

describe("TI02: tests with computed names", () => {
  it('AC-6: an it.each([[1, 2], [2, 3]])("adds %s", …) table edited with its body unchanged gives no TI02', async () => {
    const { c, base, head } = await sides("pass-each-table-edited");
    const was = base.filter((b) => b.modifiers.includes("each"));
    expect(was, "an .each test at base").toHaveLength(1);
    const w = was[0] as Block;
    expect(w.nameDynamic).toBe(true);
    expect(fileAt(c.base, PATH)?.text).toMatch(/\(\s*["'`]adds %s["'`]/);
    const now = head.filter((h) => h.modifiers.includes("each") && h.bodyHash === w.bodyHash);
    expect(now, "the same body at head").toHaveLength(1);
    expect(fileAt(c.head, PATH)?.text, "the table changed").not.toBe(fileAt(c.base, PATH)?.text);

    const report = await runCase(c);
    expect(ti02Of(report)).toEqual([]);
    expect(report.testIntegrity.languages).toEqual(["ts"]);
  });

  it("AC-6: a test named by a template literal with a substitution, renamed with its body unchanged, gives no TI02", async () => {
    const { c, base, head } = await sides("pass-template-renamed");
    const was = base.filter((b) => b.nameDynamic && !b.modifiers.includes("each"));
    expect(was, "a template-named test at base").toHaveLength(1);
    const w = was[0] as Block;
    const baseLine = fileAt(c.base, PATH)?.text.split("\n")[w.line - 1] ?? "";
    expect(baseLine, "its name is a template literal with a substitution").toMatch(/`[^`]*\$\{[^`]*`/);
    const now = head.filter((h) => h.bodyHash === w.bodyHash);
    expect(now, "the same body at head").toHaveLength(1);
    const headLine = fileAt(c.head, PATH)?.text.split("\n")[(now[0] as Block).line - 1] ?? "";
    expect(headLine, "under another name").not.toBe(baseLine);

    const report = await runCase(c);
    expect(ti02Of(report)).toEqual([]);
    expect(report.testIntegrity.languages).toEqual(["ts"]);
  });

  it('AC-6: an it.each(…)("adds %s", …) test removed with no test of a similar body left gives exactly one warn TI02 in mode block', async () => {
    const { c, base, head } = await sides("warn-each-removed");
    const was = base.filter((b) => b.modifiers.includes("each"));
    expect(was, "an .each test at base").toHaveLength(1);
    const w = was[0] as Block;
    expect(w.nameDynamic).toBe(true);
    expect(
      head.some((h) => h.modifiers.includes("each")),
      "it is gone at head",
    ).toBe(false);
    for (const h of head) {
      expect(h.bodyHash, "no head test has its body").not.toBe(w.bodyHash);
      expect(jaccard(w.body, h.body), "no head test has a similar body").toBeLessThan(0.8);
    }

    const ti02 = ti02Of(await runCase(c));
    expect(ti02).toHaveLength(1);
    expect(ti02[0]?.severity).toBe("warn");
    expect(ti02[0]?.path).toBe(PATH);
    expect(ti02[0]?.line).toBe(w.line);
  });
});
