import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI02 and
// fixtures/test-integrity/TI02/ exist, so nothing that depends on them may run while the file loads. The fixtures are
// written by the build, so each test first checks, through the existing JS/TS test index, that its fixture holds the
// case the AC describes, and derives the expected path and line from the fixture text.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CART = "src/cart.test.ts";

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

const fullName = (b: Block) => b.path.join(" › ");
const leaf = (b: Block) => b.path[b.path.length - 1] ?? "";
const fileAt = (files: SourceFile[], path: string) => files.find((f) => f.path === path);
const count = (blocks: Block[], name: string) => blocks.filter((b) => fullName(b) === name).length;
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

describe("TI02: renamed files, duplicate names, dissimilar replacements and deleted files", () => {
  it("AC-5: src/cart.test.ts renamed to src/basket.test.ts with one test removed gives one TI02 with the base path and the base line", async () => {
    const c = loadCase("block-renamed-file");
    expect(c.diff).toMatch(/^rename from src\/cart\.test\.ts$/m);
    expect(c.diff).toMatch(/^rename to src\/basket\.test\.ts$/m);
    expect(fileAt(c.head, CART), "no head text at the old path").toBeUndefined();
    const base = await testsOf(fileAt(c.base, CART));
    const head = await testsOf(fileAt(c.head, "src/basket.test.ts"));
    const removed = base.filter((b) => count(head, fullName(b)) < count(base, fullName(b)));
    expect(removed, "one test is removed in the rename").toHaveLength(1);
    expect(head.length, "the others are kept").toBe(base.length - 1);

    const ti02 = ti02Of(await runCase(c));
    expect(ti02).toHaveLength(1);
    expect(ti02[0]?.path).toBe(CART);
    expect(ti02[0]?.line).toBe(removed[0]?.line);
    expect(ti02[0]?.severity).toBe("block");
  });

  it("AC-5: a file with two tests named works at base and one at head gives one TI02", async () => {
    const c = loadCase("block-duplicate-name");
    const base = await testsOf(fileAt(c.base, CART));
    const head = await testsOf(fileAt(c.head, CART));
    const works = (blocks: Block[]) => blocks.filter((b) => leaf(b) === "works");
    expect(works(base)).toHaveLength(2);
    expect(new Set(works(base).map(fullName)).size, "the same full name twice").toBe(1);
    expect(works(head)).toHaveLength(1);
    expect(fullName(works(head)[0] as Block)).toBe(fullName(works(base)[0] as Block));

    const ti02 = ti02Of(await runCase(c));
    expect(ti02).toHaveLength(1);
    expect(ti02[0]?.path).toBe(CART);
    expect(
      works(base)
        .map((b) => b.line)
        .includes(ti02[0]?.line ?? -1),
      "on the line of one of the two",
    ).toBe(true);
  });

  it("AC-5: rejects a negative price removed while a dissimilar accepts an empty cart is added gives one block TI02 for the removed test", async () => {
    const c = loadCase("block-replaced-dissimilar");
    const base = await testsOf(fileAt(c.base, CART));
    const head = await testsOf(fileAt(c.head, CART));
    const was = base.filter((b) => leaf(b) === "rejects a negative price");
    const now = head.filter((h) => leaf(h) === "accepts an empty cart");
    expect(was).toHaveLength(1);
    expect(now).toHaveLength(1);
    expect(head.some((h) => leaf(h) === "rejects a negative price")).toBe(false);
    expect(base.some((b) => leaf(b) === "accepts an empty cart")).toBe(false);
    const [w, n] = [was[0] as Block, now[0] as Block];
    expect(n.bodyHash).not.toBe(w.bodyHash);
    expect(jaccard(w.body, n.body), "the new body is dissimilar").toBeLessThan(0.8);

    const ti02 = ti02Of(await runCase(c));
    expect(ti02).toHaveLength(1);
    expect(ti02[0]?.severity).toBe("block");
    expect(ti02[0]?.line).toBe(w.line);
    expect(ti02[0]?.detail).toContain("rejects a negative price");
  });

  it("AC-5: a deleted test file src/old.test.ts gives a TI01 signal and no TI02", async () => {
    const c = loadCase("pass-deleted-file");
    expect(c.diff).toMatch(/^deleted file mode/m);
    expect(c.diff).toContain("--- a/src/old.test.ts");
    expect(fileAt(c.head, "src/old.test.ts")).toBeUndefined();
    const base = await testsOf(fileAt(c.base, "src/old.test.ts"));
    expect(base.length, "the deleted file defined tests").toBeGreaterThan(0);

    const report = await runCase(c);
    const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01");
    expect(ti01.map((s) => s.path)).toEqual(["src/old.test.ts"]);
    expect(ti02Of(report)).toEqual([]);
  });
});
