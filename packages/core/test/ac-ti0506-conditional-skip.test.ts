import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { indexTestFile } from "../src/index.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-54: a conditional skip (skipIf, runIf) no longer excuses a test from TI05 and TI06, because the condition can
// let the test run. An unconditional `skip` or `todo` still excuses it: TI03 reports the skip. Each test first checks,
// through the JS/TS test index, that its fixture holds the case it describes.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

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
interface Report {
  testIntegrity: { signals: Signal[] };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

function loadCase(signal: "TI05" | "TI06", name: string): Case {
  const root = `${FIXTURES}test-integrity/${signal}/${name}/`;
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

/** The test of one side of a case with this name, through the JS/TS test index. */
function testNamed(files: SourceFile[], name: string) {
  const file = files.find((f) => f.path === PATH);
  if (file === undefined) throw new Error(`the fixture has no ${PATH}`);
  const result = indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${PATH} does not parse`);
  const found = result.tests.filter((b) => b.kind === "test" && b.name === name);
  expect(found, `one test named ${name}`).toHaveLength(1);
  return found[0] as (typeof found)[number];
}

const signalsOf = (report: Report, id: string) => report.testIntegrity.signals.filter((s) => s.id === id);

describe("TI05 and TI06 judge a test that carries skipIf or runIf (CORE-54)", () => {
  for (const [name, modifier] of [
    ["block-skipif-false-emptied", "skipIf"],
    ["block-runif-true-emptied", "runIf"],
  ] as const) {
    for (const mode of ["block", "warn"] as const) {
      it(`must trigger: a ${modifier} test emptied of its assertions gives one TI05 at the mode's level (${mode}), ${name}`, async () => {
        const c = loadCase("TI05", name);
        const base = testNamed(c.base, "totals an empty cart");
        const head = testNamed(c.head, "totals an empty cart");
        expect(base.modifiers).toContain(modifier);
        expect(head.modifiers).toEqual([modifier]);
        expect(base.assertionCount).toBe(2);
        expect(head.assertionCount).toBe(0);

        const report = await runCase(c, mode);
        const ti05 = signalsOf(report, "TI05");
        expect(ti05).toHaveLength(1);
        expect(ti05[0]).toMatchObject({ id: "TI05", severity: mode, path: PATH, line: head.line });
        expect(signalsOf(report, "TI03"), "the condition was already there: no skip added").toEqual([]);
      });
    }
  }

  it("must trigger: a skipIf(cond) test whose matcher is weakened gives one TI06 warn", async () => {
    const c = loadCase("TI06", "warn-skipif-weakened");
    const base = testNamed(c.base, "adds the prices");
    const head = testNamed(c.head, "adds the prices");
    expect(base.modifiers).toEqual(["skipIf"]);
    expect(head.modifiers).toEqual(["skipIf"]);
    expect(head.body).toContain(".toBeTruthy()");

    for (const mode of ["block", "warn"] as const) {
      const report = await runCase(c, mode);
      const ti06 = signalsOf(report, "TI06");
      expect(ti06).toHaveLength(1);
      expect(ti06[0]).toMatchObject({
        id: "TI06",
        severity: "warn",
        path: PATH,
        line: head.line,
        detail: "The test was weakened: toBe → toBeTruthy.",
      });
      expect(signalsOf(report, "TI05")).toEqual([]);
    }
  });

  for (const [name, modifier] of [
    ["pass-became-skip", "skip"],
    ["pass-became-todo", "todo"],
  ] as const) {
    it(`must not trigger: a test that becomes ${modifier} and is emptied gives no TI05; TI03 reports the skip (${name})`, async () => {
      const c = loadCase("TI05", name);
      const head = testNamed(c.head, "totals an empty cart");
      expect(head.modifiers).toContain(modifier);
      expect(testNamed(c.base, "totals an empty cart").assertionCount).toBe(2);

      const report = await runCase(c, "block");
      expect(signalsOf(report, "TI05")).toEqual([]);
      expect(signalsOf(report, "TI03").length).toBeGreaterThan(0);
    });
  }

  it("must not trigger: a skip test whose matcher is weakened gives no TI06", async () => {
    const c = loadCase("TI06", "pass-skip-weakened");
    const head = testNamed(c.head, "adds the prices");
    expect(testNamed(c.base, "adds the prices").modifiers).toEqual(["skip"]);
    expect(head.modifiers).toEqual(["skip"]);
    expect(head.body).toContain(".toBeTruthy()");

    const report = await runCase(c, "block");
    expect(signalsOf(report, "TI06")).toEqual([]);
    expect(signalsOf(report, "TI05")).toEqual([]);
  });

  it("must not trigger: a skipIf(isWindows) test the change does not touch gives no TI05 and no TI06", async () => {
    const c = loadCase("TI05", "pass-skipif-unchanged");
    const base = testNamed(c.base, "totals an empty cart");
    const head = testNamed(c.head, "totals an empty cart");
    expect(head.modifiers).toEqual(["skipIf"]);
    expect(head.body).toBe(base.body);

    const report = await runCase(c, "block");
    expect(report.testIntegrity.signals).toEqual([]);
  });
});
