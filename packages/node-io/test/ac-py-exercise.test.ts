import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-104 (R3.8): TESTS_NOT_EXERCISING_CHANGES covers Python. Each case under fixtures/exercise/py-*/ is a diff
// (change.diff), the tracked files at HEAD (files.txt) and the touched test files' text at the merge base and at HEAD
// (base/ and head/, each file stored as <path>.txt). The sources go through the real python3 with node-io's
// indexPythonTestSources and then through check(), as the CLI and the Action run them; there is no skip, so with no
// usable python3 the tests fail. Everything the build changes is loaded inside the test bodies.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TESTS_NOT_EXERCISING_CHANGES";
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const SLOW = 60_000;

interface SourceFile {
  path: string;
  text: string;
}
interface Case {
  diff: string;
  repoFiles: string[];
  base: SourceFile[];
  head: SourceFile[];
}
interface Report {
  messages: { code: string; level: string; text: string }[];
  testIntegrity: { exercise?: { checked: number; notExercised: string[] } };
}

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
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function loadCase(name: string): Case {
  const root = `${FIXTURES}exercise/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    repoFiles: readFileSync(`${root}files.txt`, "utf8").trim().split("\n"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

type Index = (files: readonly SourceFile[]) => Promise<unknown>;

/** Indexes the case's Python test sources (with the real python3 unless `index` is given), then runs check(). */
async function runCase(c: Case, index?: Index): Promise<Report> {
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown, index?: Index): Promise<{ available: boolean } | undefined>;
  };
  const sources = { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } };
  const pythonTestIndex = await io.indexPythonTestSources(sources, index);
  if (index === undefined) expect(pythonTestIndex?.available, "the real python3 indexed the tests").toBe(true);
  const { check } = await import("../../core/test/text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { missingFile: "coverage/lcov.info" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: c.repoFiles,
    testSources: sources,
    pythonTestIndex,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const exerciseOf = (report: Report) => report.messages.filter((m) => m.code === CODE);

/** The case with every import line of its head test files replaced by `import json`, which maps to no changed file. */
function withoutSubjectImport(c: Case): Case {
  const strip = (text: string) =>
    text
      .split("\n")
      .map((line) => (/^(?:from|import)\s/.test(line) ? "import json" : line))
      .join("\n");
  return { ...c, head: c.head.map((file) => ({ path: file.path, text: strip(file.text) })) };
}

describe("CORE-104: TESTS_NOT_EXERCISING_CHANGES on Python, must trigger", () => {
  const cases: Array<[string, string]> = [
    ["py-warn-src", "src/pkg/billing.py"],
    ["py-warn-flat", "pkg/billing.py"],
  ];
  for (const [name, path] of cases) {
    it(
      `AC-1: ${name}: a new ${path} that the changed tests import nothing from gives the warning naming it`,
      async () => {
        const report = await runCase(loadCase(name));
        const messages = exerciseOf(report);
        expect(messages).toHaveLength(1);
        expect(messages[0]?.level).toBe("warn");
        expect(messages[0]?.text).toContain(
          `1 of 1 changed source file is not imported by a test file this change adds or modifies: \`${path}\`.`,
        );
        expect(report.testIntegrity.exercise).toEqual({ checked: 1, notExercised: [path] });
      },
      SLOW,
    );
  }
});

describe("CORE-104: TESTS_NOT_EXERCISING_CHANGES on Python, must not trigger", () => {
  const cases: Array<[string, string, string]> = [
    ["py-pass-from-src", "src/pkg/billing.py", "a modified tests/test_billing.py with `from pkg.billing import total`"],
    ["py-pass-from-flat", "pkg/billing.py", "a modified tests/test_billing.py with `from pkg.billing import total`"],
    ["py-pass-import-as-src", "src/pkg/billing.py", "an added tests/test_billing.py with `import pkg.billing as b`"],
    ["py-pass-import-as-flat", "pkg/billing.py", "an added tests/test_billing.py with `import pkg.billing as b`"],
    ["py-pass-relative-src", "src/pkg/billing.py", "an added test beside the module with `from . import billing`"],
    ["py-pass-relative-flat", "pkg/billing.py", "an added test beside the module with `from . import billing`"],
  ];
  for (const [name, path, why] of cases) {
    it(
      `AC-2: ${name}: ${why} exercises ${path}`,
      async () => {
        const c = loadCase(name);
        // Control: the same case whose test imports something else gives the warning for the file.
        const control = await runCase(withoutSubjectImport(c));
        expect(control.testIntegrity.exercise, "control: without the import the file is not exercised").toEqual({
          checked: 1,
          notExercised: [path],
        });
        const report = await runCase(c);
        expect(exerciseOf(report)).toEqual([]);
        expect("exercise" in report.testIntegrity).toBe(false);
      },
      SLOW,
    );
  }
});

describe("CORE-104: without python3 on the runner", () => {
  it(
    "AC-3: gives no tests-exercise message and no new error, and the index-unavailable message is as without the Python source",
    async () => {
      const c = loadCase("py-warn-src");
      // Control: with the real python3 the new source file is reported.
      const control = await runCase(c);
      expect(control.testIntegrity.exercise).toEqual({ checked: 1, notExercised: ["src/pkg/billing.py"] });

      const notFound: Index = async () => ({
        available: false,
        reason: "python-not-found",
        detail: "no Python interpreter found: tried python3, python",
      });
      const report = await runCase(c, notFound);
      expect(exerciseOf(report)).toEqual([]);
      expect("exercise" in report.testIntegrity).toBe(false);

      // The same run without the Python source file in the diff: every message is the same.
      const testOnly = c.diff.slice(c.diff.indexOf("diff --git a/tests/"));
      expect(testOnly.startsWith("diff --git a/tests/test_other.py")).toBe(true);
      const before = await runCase({ ...c, diff: testOnly }, notFound);
      expect(report.messages.filter((m) => m.code === UNAVAILABLE)).toHaveLength(1);
      expect(report.messages.filter((m) => m.code === UNAVAILABLE)).toEqual(
        before.messages.filter((m) => m.code === UNAVAILABLE),
      );
      expect(report.messages.filter((m) => m.level === "error")).toEqual([]);
      expect(report.messages.map((m) => m.code)).toEqual(before.messages.map((m) => m.code));
    },
    SLOW,
  );
});
