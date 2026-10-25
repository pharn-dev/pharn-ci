import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI12 and
// fixtures/test-integrity/TI12/ exist, so nothing that depends on them may run while the file loads. Each fixture is
// written by the build, so each test first checks the diff entries and, through the existing JS/TS test index, the
// head mock the AC describes, and derives the expected line from the fixture text.

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
interface Mock {
  callee: string;
  specifier: string | null;
  line: number;
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
  const root = `${FIXTURES}test-integrity/TI12/${name}/`;
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

async function mocksOf(file: SourceFile | undefined): Promise<Mock[]> {
  if (file === undefined) return [];
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; mocks?: Mock[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return result.mocks ?? [];
}

/** Whether the diff holds the line `first` directly followed by the line `second`. */
const linePair = (diff: string, first: string, second: string) => {
  const all = diff.split("\n");
  return all.some((line, i) => line === first && all[i + 1] === second);
};
const modified = (diff: string, path: string) => linePair(diff, `--- a/${path}`, `+++ b/${path}`);
const added = (diff: string, path: string) => linePair(diff, "--- /dev/null", `+++ b/${path}`);
const renamed = (diff: string, from: string, to: string) => linePair(diff, `rename from ${from}`, `rename to ${to}`);

const CASES: ReadonlyArray<{
  name: string;
  title: string;
  test: string;
  testAdded: boolean;
  callee: string;
  specifier: string;
  target: string;
  source(diff: string): boolean;
}> = [
  {
    name: "warn-js-twin",
    title: 'a modified test/cart.test.ts adding jest.mock("../lib/price.js") with lib/price.ts modified',
    test: "test/cart.test.ts",
    testAdded: false,
    callee: "jest.mock",
    specifier: "../lib/price.js",
    target: "lib/price.ts",
    source: (diff) => modified(diff, "lib/price.ts"),
  },
  {
    name: "warn-index-file",
    title: 'a modified src/cart.test.ts adding vi.mock("./store") with src/store/index.ts added',
    test: "src/cart.test.ts",
    testAdded: false,
    callee: "vi.mock",
    specifier: "./store",
    target: "src/store/index.ts",
    source: (diff) => added(diff, "src/store/index.ts"),
  },
  {
    name: "warn-added-test-file",
    title: 'an added src/tax.test.ts holding vi.doMock("./tax") with src/tax.mts modified',
    test: "src/tax.test.ts",
    testAdded: true,
    callee: "vi.doMock",
    specifier: "./tax",
    target: "src/tax.mts",
    source: (diff) => modified(diff, "src/tax.mts"),
  },
  {
    name: "warn-renamed-source",
    title:
      'a modified src/cart.test.ts adding jest.doMock("./old-name") with src/old-name.ts renamed to src/new-name.ts',
    test: "src/cart.test.ts",
    testAdded: false,
    callee: "jest.doMock",
    specifier: "./old-name",
    target: "src/new-name.ts",
    source: (diff) => renamed(diff, "src/old-name.ts", "src/new-name.ts"),
  },
];

describe("TI12: a mock resolved to a changed source file", () => {
  for (const { name, title, test, testAdded, callee, specifier, target, source } of CASES) {
    it(`AC-9: ${title} gives exactly one warn TI12 on ${test} whose detail holds ${target}`, async () => {
      const c = loadCase(name);
      expect(
        testAdded ? added(c.diff, test) : modified(c.diff, test),
        `${test} is ${testAdded ? "added" : "modified"}`,
      ).toBe(true);
      expect(source(c.diff), `the source change of ${target}`).toBe(true);
      const isMock = (m: Mock) => m.callee === callee && m.specifier === specifier;
      const baseMocks = await mocksOf(c.base.find((f) => f.path === test));
      expect(baseMocks.filter(isMock), "not at base").toEqual([]);
      const headMocks = (await mocksOf(c.head.find((f) => f.path === test))).filter(isMock);
      expect(headMocks, `one ${callee}("${specifier}") at head`).toHaveLength(1);

      const report = await runBlock(c);
      const ti12 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI12");
      expect(ti12).toHaveLength(1);
      const signal = ti12[0] as Signal;
      expect(signal.severity).toBe("warn");
      expect(signal.path).toBe(test);
      expect(signal.line).toBe((headMocks[0] as Mock).line);
      expect(signal.detail).toContain(target);
      expect(signal.detail).toContain(`${callee}("${specifier}")`);
    });
  }
});
