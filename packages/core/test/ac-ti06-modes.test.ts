import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI06 and
// fixtures/test-integrity/TI06/ exist, so nothing that depends on them may run while the file loads. The fixture is
// written by the build, so each test first checks, through the existing JS/TS test index, that it holds the case the
// AC describes, and derives the expected head line from the fixture text.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const NAME = "cart › adds the prices";

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
  const root = `${FIXTURES}test-integrity/TI06/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

/** Every new-side path the diff names. */
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

/** The case: `toBe(5)` becomes `toBeTruthy()` in `cart › adds the prices`, and every other test is unchanged. */
async function theCase(): Promise<{ c: Case; now: Block }> {
  const c = loadCase("warn-tobe-truthy");
  expect(c.diff).toContain(`--- a/${PATH}`);
  expect(c.diff).toContain(`+++ b/${PATH}`);
  const base = await testsOf(fileAt(c.base, PATH));
  const head = await testsOf(fileAt(c.head, PATH));
  const was = base.filter((t) => fullName(t) === NAME);
  const now = head.filter((t) => fullName(t) === NAME);
  expect(was, `one ${NAME} at base`).toHaveLength(1);
  expect(now, `one ${NAME} at head`).toHaveLength(1);
  expect((was[0] as Block).body).toContain("expect(total([2, 3])).toBe(5);");
  expect((now[0] as Block).body).toContain("expect(total([2, 3])).toBeTruthy();");
  expect((now[0] as Block).body).not.toContain("toBe(5)");
  for (const m of ["skip", "todo", "skipIf", "runIf"]) expect((now[0] as Block).modifiers).not.toContain(m);
  const others = (tests: Block[]) =>
    tests
      .filter((t) => fullName(t) !== NAME)
      .map((t) => `${fullName(t)} ${t.bodyHash}`)
      .sort();
  expect(others(head), "every other test is unchanged").toEqual(others(base));
  return { c, now: now[0] as Block };
}

describe("TI06: a matcher downgraded from toBe to toBeTruthy, in each mode", () => {
  for (const mode of ["block", "warn"] as const) {
    it(`AC-1: in mode ${mode} the downgraded test gives exactly one warn TI06 at its head line, with no base or head field, a detail naming toBe → toBeTruthy and neither the test name nor the assertion text, and one warn TEST_INTEGRITY_TI06 message`, async () => {
      const { c, now } = await theCase();
      const report = await runCase(c, mode);

      const ti06 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
      expect(ti06).toHaveLength(1);
      const signal = ti06[0] as Signal;
      expect(signal.path).toBe(PATH);
      expect(signal.line).toBe(now.line);
      expect(signal.severity).toBe("warn");
      expect(Object.keys(signal)).not.toContain("base");
      expect(Object.keys(signal)).not.toContain("head");
      expect(signal.detail).toContain("toBe → toBeTruthy");
      expect(signal.detail).not.toContain("adds the prices");
      expect(signal.detail).not.toContain("total([2, 3])");

      const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI06");
      expect(messages).toHaveLength(1);
      expect(messages[0]?.level).toBe("warn");
    });
  }

  it("AC-1: in mode off the same change gives no TI06 signal and no TEST_INTEGRITY_TI06 message", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    expect(typeof core.detectTI06, "TI06 exists, so its absence in mode off is the mode's doing").toBe("function");
    const { c } = await theCase();
    const report = await runCase(c, "off");
    expect(report.testIntegrity.signals.filter((s) => String(s.id) === "TI06")).toEqual([]);
    expect(report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI06")).toEqual([]);
  });
});
