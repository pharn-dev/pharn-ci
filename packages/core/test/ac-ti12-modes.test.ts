import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI12 and
// fixtures/test-integrity/TI12/ exist, so nothing that depends on them may run while the file loads. The fixture is
// written by the build, so each test first checks, through the existing JS/TS test index, that the head adds the two
// mocks the AC describes, and derives the expected line from the fixture text.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const SOURCE = "src/cart.ts";

type Mode = "block" | "warn" | "off";
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
  messages: { code: string; level: string; text: string }[];
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

async function runCase(c: Case, mode: Mode): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), ...diffPaths(c.diff)])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

/** The file-level mocks of one fixture file, through the existing JS/TS test index. */
async function mocksOf(file: SourceFile | undefined): Promise<Mock[]> {
  if (file === undefined) throw new Error("the fixture file is missing");
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; mocks?: Mock[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return result.mocks ?? [];
}

/** The case: the diff modifies src/cart.ts and src/cart.test.ts; head adds vi.mock("./cart") and later vi.mock("./cart.js"). */
async function theCase(): Promise<{ c: Case; line: number }> {
  const c = loadCase("warn-vi-mock");
  for (const path of [SOURCE, PATH]) {
    expect(c.diff).toContain(`--- a/${path}`);
    expect(c.diff).toContain(`+++ b/${path}`);
  }
  const base = await mocksOf(c.base.find((f) => f.path === PATH));
  const head = await mocksOf(c.head.find((f) => f.path === PATH));
  expect(base, "no mock at base").toEqual([]);
  const plain = head.filter((m) => m.callee === "vi.mock" && m.specifier === "./cart");
  const withJs = head.filter((m) => m.callee === "vi.mock" && m.specifier === "./cart.js");
  expect(plain, 'one vi.mock("./cart") at head').toHaveLength(1);
  expect(withJs, 'one vi.mock("./cart.js") at head').toHaveLength(1);
  expect((plain[0] as Mock).line, 'vi.mock("./cart.js") comes later').toBeLessThan((withJs[0] as Mock).line);
  return { c, line: (plain[0] as Mock).line };
}

describe("TI12: a mock of the module the change edits, in each mode", () => {
  for (const mode of ["block", "warn"] as const) {
    it(`AC-8: in mode ${mode} vi.mock("./cart") and vi.mock("./cart.js") of the edited src/cart.ts give exactly one warn TI12 at the first mock's line, naming the mock and src/cart.ts, and one warn TEST_INTEGRITY_TI12 message`, async () => {
      const { c, line } = await theCase();
      const report = await runCase(c, mode);
      const ti12 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI12");
      expect(ti12).toHaveLength(1);
      const signal = ti12[0] as Signal;
      expect(signal.path).toBe(PATH);
      expect(signal.line).toBe(line);
      expect(signal.severity).toBe("warn");
      expect(signal.detail).toContain('vi.mock("./cart")');
      expect(signal.detail).toContain(SOURCE);
      const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI12");
      expect(messages).toHaveLength(1);
      expect(messages[0]?.level).toBe("warn");
    });
  }

  it("AC-8: in mode off the same change gives no TI12 signal and no TEST_INTEGRITY_TI12 message", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    expect(typeof core.detectTI12, "TI12 exists, so its absence in mode off is the mode's doing").toBe("function");
    const { c } = await theCase();
    const report = await runCase(c, "off");
    expect(report.testIntegrity.signals.filter((s) => String(s.id) === "TI12")).toEqual([]);
    expect(report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI12")).toEqual([]);
  });
});
