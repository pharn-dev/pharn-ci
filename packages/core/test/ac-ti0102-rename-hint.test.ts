import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixture are loaded inside the test body: the AC test is written before the rename
// hint and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run while the file loads. The
// fixture is written by the build, so the test first checks, through the existing JS/TS test index, that it holds the
// case: a suite rewritten inside one describe whose test count grows, several base tests gone by name and by body.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/queue.test.ts";

interface SourceFile {
  path: string;
  text: string;
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
  bodyHash: string;
}
interface Report {
  verdict: string;
  testIntegrity: { verdict: string; signals: Signal[]; languages: string[] };
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

async function testsOf(files: SourceFile[], path: string): Promise<Block[]> {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return (result.tests ?? []).filter((b) => b.kind === "test");
}

const fullName = (b: Block) => b.path.join(" › ");
const groupOf = (b: Block) => JSON.stringify(b.path.slice(0, -1));
const removedDetail = (name: string, line: number) =>
  `The test "${name}" at line ${line} of the base is gone at head, and no test with the same name or a similar body takes its place.`;

// The rename hint (a similar name or body in the group, in a file that did not lose tests, softened the finding to a
// warn) was dropped in review: names are what a change controls, so a name alone must never loosen a gate. A suite
// rewritten under reworded names is therefore a known false block (docs/LIMITS.md), cleared with the accept label.
describe("TI02 precision: a suite rewritten under reworded names still blocks", () => {
  it("AC-5: a suite rewritten in one describe whose test count grows gives block TI02 signals with today's detail, a fail verdict and an error TEST_INTEGRITY_TI02 message", async () => {
    const root = `${FIXTURES}test-integrity-precision/TI02/block-suite-rewritten/`;
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);

    expect(diff).toContain(`--- a/${PATH}`);
    expect(diff).toContain(`+++ b/${PATH}`);
    expect(diff).not.toMatch(/^(new|deleted) file mode/m);
    const baseTests = await testsOf(base, PATH);
    const headTests = await testsOf(head, PATH);
    expect(headTests.length, "the file's test count grows").toBeGreaterThan(baseTests.length);
    const groups = new Set([...baseTests, ...headTests].map(groupOf));
    expect(groups.size, "every test sits in one describe").toBe(1);
    const headNames = new Set(headTests.map(fullName));
    const headBodies = new Set(headTests.map((h) => h.bodyHash));
    const gone = baseTests.filter((b) => !headNames.has(fullName(b)) && !headBodies.has(b.bodyHash));
    expect(gone.length, "several base tests are gone by name and by exact body").toBeGreaterThanOrEqual(2);

    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...new Set([...head.map((f) => f.path), "src/queue.ts"])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
    expect(ti02.length, "the gone tests are reported").toBeGreaterThan(0);
    const byLine = new Map(gone.map((b) => [b.line, b]));
    for (const signal of ti02) {
      expect(signal.severity).toBe("block");
      expect(signal.path).toBe(PATH);
      const was = byLine.get(signal.line as number);
      expect(was, `the signal at line ${signal.line} is one of the gone base tests`).toBeDefined();
      expect(signal.detail).toBe(removedDetail(fullName(was as Block), (was as Block).line));
      expect(signal.detail).not.toContain("may have been renamed");
    }
    expect(report.testIntegrity.verdict).toBe("fail");
    const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI02");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
  });
});
