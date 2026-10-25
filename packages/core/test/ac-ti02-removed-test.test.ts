import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI02 and
// fixtures/test-integrity/TI02/ exist, so nothing that depends on them may run while the file loads. The fixture is
// written by the build, so the test first checks, through the existing JS/TS test index, that it holds the case the AC
// describes, and derives the expected line from the fixture text rather than from a value the build chose.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const REMOVED = "cart › rejects a negative price";

type Mode = "block" | "warn";
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
  assertionCount: number;
  guards: unknown[];
}
interface Report {
  testIntegrity: { signals: Signal[]; languages: string[] };
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
  const root = `${FIXTURES}test-integrity/TI02/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

async function runCase(c: Case, mode: Mode): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const signalsOf = (report: Report, id: string) => report.testIntegrity.signals.filter((s) => String(s.id) === id);

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
const key = (b: Block) => `${fullName(b)}#${b.bodyHash}`;

describe("TI02: one test removed from a test file that stays", () => {
  for (const [mode, level] of [
    ["block", "error"],
    ["warn", "warn"],
  ] as const) {
    it(`AC-1: in mode ${mode} the removed it gives exactly one TI02 signal at its base line with its full name, one ${level} message, languages ["ts"], and a valid report`, async () => {
      const c = loadCase("block-removed-it");

      // The fixture: a modified src/cart.test.ts whose head is its base with one it("rejects a negative price")
      // inside describe("cart") removed and every other test unchanged.
      expect(c.diff).toContain(`--- a/${PATH}`);
      expect(c.diff).toContain(`+++ b/${PATH}`);
      const baseFile = fileAt(c.base, PATH);
      const base = await testsOf(baseFile);
      const head = await testsOf(fileAt(c.head, PATH));
      const removed = base.filter((b) => fullName(b) === REMOVED);
      expect(removed, "the base holds the test once").toHaveLength(1);
      const target = removed[0] as Block;
      expect(head.length, "the head keeps other tests").toBeGreaterThan(0);
      expect(head.map(key).sort(), "every other test is unchanged").toEqual(
        base
          .filter((b) => b !== target)
          .map(key)
          .sort(),
      );
      const baseLine = (baseFile as SourceFile).text.split("\n")[target.line - 1] ?? "";
      expect(baseLine, "the index line is the 1-based base line of the it").toContain("rejects a negative price");

      const report = await runCase(c, mode);
      const ti02 = signalsOf(report, "TI02");
      expect(ti02).toHaveLength(1);
      const signal = ti02[0] as Signal;
      expect(signal.path).toBe(PATH);
      expect(signal.line).toBe(target.line);
      expect(signal.detail).toContain(REMOVED);
      expect(signal.detail, "the detail says the line is at base").toMatch(/\bbase\b/);
      expect(signal.detail.length).toBeLessThanOrEqual(300);
      expect(signal.severity).toBe(mode);

      const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI02");
      expect(messages).toHaveLength(1);
      expect(messages[0]?.level).toBe(level);
      expect(report.testIntegrity.languages).toEqual(["ts"]);
    });
  }
});
