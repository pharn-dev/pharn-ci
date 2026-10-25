import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI12 and
// fixtures/test-integrity/TI12/ exist, so nothing that depends on them may run while the file loads. Each fixture is
// written by the build, so each test first checks its diff entries and, through the existing JS/TS test index, its
// mocks; and each test checks that detectTI12 exists, so "no TI12" means TI12 ran and did not fire.

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

async function mocksOf(files: SourceFile[], path: string): Promise<Mock[]> {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
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
const deleted = (diff: string, path: string) => linePair(diff, `--- a/${path}`, "+++ /dev/null");
const touches = (diff: string, path: string) => diff.includes(` a/${path}`) || diff.includes(` b/${path}`);
const viMocks = (mocks: Mock[], specifier: string) =>
  mocks.filter((m) => m.callee === "vi.mock" && m.specifier === specifier);

/** The modified src/cart.test.ts: its head adds vi.mock(`specifier`), absent at base. */
async function addsMock(c: Case, specifier: string, path = "src/cart.test.ts"): Promise<void> {
  expect(modified(c.diff, path), `${path} is modified`).toBe(true);
  expect(viMocks(await mocksOf(c.base, path), specifier), "not at base").toEqual([]);
  expect(viMocks(await mocksOf(c.head, path), specifier), `vi.mock("${specifier}") at head`).toHaveLength(1);
}

const CASES: ReadonlyArray<{ name: string; title: string; holds(c: Case): Promise<void> }> = [
  {
    name: "pass-source-untouched",
    title: 'head adds vi.mock("./cart") while the diff does not touch src/cart.ts',
    holds: async (c) => {
      await addsMock(c, "./cart");
      expect(touches(c.diff, "src/cart.ts"), "src/cart.ts is not in the diff").toBe(false);
    },
  },
  {
    name: "pass-mock-moved-line",
    title: 'vi.mock("./cart") at base moving to another line at head, with src/cart.ts modified',
    holds: async (c) => {
      expect(modified(c.diff, "src/cart.test.ts")).toBe(true);
      expect(modified(c.diff, "src/cart.ts")).toBe(true);
      const base = viMocks(await mocksOf(c.base, "src/cart.test.ts"), "./cart");
      const head = viMocks(await mocksOf(c.head, "src/cart.test.ts"), "./cart");
      expect(base).toHaveLength(1);
      expect(head).toHaveLength(1);
      expect((head[0] as Mock).line, "another line").not.toBe((base[0] as Mock).line);
    },
  },
  {
    name: "pass-mock-moved-file",
    title:
      'vi.mock("./cart") leaving the compared src/a.test.ts for the compared src/b.test.ts, with src/cart.ts modified',
    holds: async (c) => {
      for (const path of ["src/a.test.ts", "src/b.test.ts", "src/cart.ts"])
        expect(modified(c.diff, path), path).toBe(true);
      expect(viMocks(await mocksOf(c.base, "src/a.test.ts"), "./cart")).toHaveLength(1);
      expect(viMocks(await mocksOf(c.head, "src/a.test.ts"), "./cart")).toEqual([]);
      expect(viMocks(await mocksOf(c.base, "src/b.test.ts"), "./cart")).toEqual([]);
      expect(viMocks(await mocksOf(c.head, "src/b.test.ts"), "./cart")).toHaveLength(1);
    },
  },
  ...(["axios", "@/cart", "~/cart", "#cart"] as const).map((specifier) => ({
    name: {
      axios: "pass-bare-specifier",
      "@/cart": "pass-alias-at",
      "~/cart": "pass-alias-tilde",
      "#cart": "pass-alias-hash",
    }[specifier],
    title: `head adds vi.mock("${specifier}") with src/cart.ts modified`,
    holds: async (c: Case) => {
      await addsMock(c, specifier);
      expect(modified(c.diff, "src/cart.ts")).toBe(true);
    },
  })),
  {
    name: "pass-mock-test-file",
    title: 'head adds vi.mock("./helpers.test") with src/helpers.test.ts modified',
    holds: async (c) => {
      await addsMock(c, "./helpers.test");
      expect(modified(c.diff, "src/helpers.test.ts")).toBe(true);
    },
  },
  {
    name: "pass-source-deleted",
    title: 'head adds vi.mock("./gone") with src/gone.ts deleted',
    holds: async (c) => {
      await addsMock(c, "./gone");
      expect(deleted(c.diff, "src/gone.ts"), "src/gone.ts is deleted").toBe(true);
    },
  },
  {
    name: "pass-escapes-root",
    title: 'head adds vi.mock("../../cart") in src/a.test.ts with src/cart.ts modified',
    holds: async (c) => {
      await addsMock(c, "../../cart", "src/a.test.ts");
      expect(modified(c.diff, "src/cart.ts")).toBe(true);
    },
  },
  {
    name: "pass-test-renamed",
    title:
      'src/a.test.ts holding vi.mock("./cart") at base renamed to src/b.test.ts that still holds it, with src/cart.ts modified',
    holds: async (c) => {
      expect(c.diff).toMatch(/^rename from src\/a\.test\.ts\nrename to src\/b\.test\.ts$/m);
      expect(modified(c.diff, "src/cart.ts")).toBe(true);
      expect(viMocks(await mocksOf(c.base, "src/a.test.ts"), "./cart")).toHaveLength(1);
      expect(viMocks(await mocksOf(c.head, "src/b.test.ts"), "./cart")).toHaveLength(1);
      expect(c.head.map((f) => f.path)).not.toContain("src/a.test.ts");
    },
  },
];

describe("TI12: mocks that do not replace a source file the change edits give no finding", () => {
  for (const { name, title, holds } of CASES) {
    it(`AC-11: ${title} gives no TI12`, async () => {
      const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
      expect(typeof core.detectTI12, "TI12 exists, so its absence here is the case's doing").toBe("function");
      const c = loadCase(name);
      await holds(c);
      const report = await runBlock(c);
      expect(report.testIntegrity.signals.filter((s) => String(s.id) === "TI12")).toEqual([]);
    });
  }
});
