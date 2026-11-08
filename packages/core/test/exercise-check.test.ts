import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CheckInput, check } from "../src/check.js";
import { buildReport, type Report } from "../src/report.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// A8 step 1 (tests exercise the changed lines), TESTS_NOT_EXERCISING_CHANGES through check(). Each case under
// fixtures/exercise/ is a diff (change.diff), the tracked files at HEAD (files.txt) and the touched test files' text at
// the merge base and at HEAD (base/ and head/, each file stored as <path>.txt). warn-* cases must give the one warn
// message and testIntegrity.exercise; pass-* cases must give neither.

const CODE = "TESTS_NOT_EXERCISING_CHANGES";
const REPO_ROOT = "/home/runner/work/demo/demo";

function sideFiles(dir: string): Array<{ path: string; text: string }> {
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

/** The check input of a fixture case, with a coverage file that is not found (a warn without a threshold). */
function caseInput(name: string, extra: Partial<CheckInput> = {}): CheckInput {
  const root = `${FIXTURES}exercise/${name}/`;
  return {
    version: "0.1.0",
    coverage: { missingFile: "coverage/lcov.info" },
    diff: { text: fixture(`exercise/${name}/change.diff`) },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: fixture(`exercise/${name}/files.txt`).trim().split("\n"),
    testSources: {
      base: { files: sideFiles(`${root}base`), dropped: [] },
      head: { files: sideFiles(`${root}head`), dropped: [] },
    },
    ...extra,
  };
}

const exerciseOf = (report: Report) => report.messages.filter((message) => message.code === CODE);

function run(input: CheckInput): Report {
  const report = check(input);
  expectValidReport(report);
  return report;
}

describe("TESTS_NOT_EXERCISING_CHANGES, must trigger", () => {
  const cases: Array<[string, string]> = [
    ["warn-no-test", "a source file changes and no test file changes"],
    ["warn-test-imports-other", "the changed test file imports another source file"],
    ["warn-fewer-assertions", "the changed test file that imports it has fewer assertions at head"],
    ["warn-mock-only", "the added test file only mocks it (a mock path and a dynamic import passed to vi.mock)"],
    ["warn-type-only", "the added test file imports only its types"],
    ["warn-alias", "the added test file imports it through an alias and a bare specifier, which are not resolved"],
    ["warn-no-assertions", "the added test file that imports it has no assertion"],
  ];
  for (const [name, why] of cases) {
    it(`${name}: ${why}`, () => {
      const report = run(caseInput(name));
      const messages = exerciseOf(report);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.level).toBe("warn");
      expect(messages[0]?.text).toBe(
        "1 of 1 changed source file is not imported by a test file this change adds or modifies: `src/cart.ts`. A changed source file counts as exercised when a test file the change adds or modifies imports it directly (a relative import) and keeps or raises its assertion count.",
      );
      expect(report.testIntegrity.exercise).toEqual({ checked: 1, notExercised: ["src/cart.ts"] });
    });
  }
});

describe("TESTS_NOT_EXERCISING_CHANGES, must not trigger", () => {
  const cases: Array<[string, string]> = [
    ["pass-added-test", "an added test imports both changed files, one without an extension, one by its .ts path"],
    ["pass-js-twin", "a modified test keeps its assertion count and imports ../src/cart.js, the TypeScript twin"],
    ["pass-index", "the test imports the directory whose index.ts changes"],
    ["pass-require", "a CommonJS test requires the changed .js file"],
    ["pass-dynamic-import", "the test imports the changed file dynamically"],
  ];
  for (const [name, why] of cases) {
    it(`${name}: ${why}`, () => {
      const report = run(caseInput(name));
      expect(exerciseOf(report)).toEqual([]);
      expect("exercise" in report.testIntegrity).toBe(false);
    });
  }

  it("pass-not-checked: build output, vendored, minified, generated, declaration, config, test-directory, Python, Markdown, binary, deleted, rename-only, removal-only and coverage-excluded files are not checked", () => {
    const report = run(caseInput("pass-not-checked", { exclude: ["src/excluded.ts"] }));
    expect(exerciseOf(report)).toEqual([]);
    expect("exercise" in report.testIntegrity).toBe(false);
    // Control: without the exclusion the excluded file is the one checked, and it is not exercised.
    const control = run(caseInput("pass-not-checked"));
    expect(control.testIntegrity.exercise).toEqual({ checked: 1, notExercised: ["src/excluded.ts"] });
  });
});

describe("TESTS_NOT_EXERCISING_CHANGES, when it runs", () => {
  it("is silent in mode off, without test sources, with the head side unavailable, when the touched test files were not read, and without a diff", () => {
    const silent = (label: string, input: CheckInput) => {
      const report = run(input);
      expect(exerciseOf(report), label).toEqual([]);
      expect("exercise" in report.testIntegrity, label).toBe(false);
    };
    silent("mode off", caseInput("warn-no-test", { testIntegrityMode: { input: "off" } }));
    const { testSources: _sources, ...withoutSources } = caseInput("warn-no-test");
    silent("no test sources", withoutSources);
    silent(
      "head unavailable",
      caseInput("warn-no-test", {
        testSources: { base: { files: [], dropped: [] }, head: { unavailable: "shallow" } },
      }),
    );
    silent(
      "base unavailable with a modified test file (not run)",
      caseInput("warn-fewer-assertions", {
        testSources: { base: { unavailable: "shallow" }, head: { files: [], dropped: [] } },
      }),
    );
    silent("diff unavailable", caseInput("warn-no-test", { diff: { unavailable: "no merge base" } }));
  });

  it("warns and never fails, in mode block too: the verdict becomes warn, testIntegrity.verdict is left alone", () => {
    const coverage = { text: "SF:src/cart.ts\nDA:2,1\nend_of_record\n", format: "lcov" as const };
    const before = run(caseInput("pass-js-twin", { coverage, testIntegrityMode: { input: "block" } }));
    expect(before.verdict, "control: a covered, exercised change passes").toBe("pass");
    const report = run(caseInput("warn-no-test", { coverage, testIntegrityMode: { input: "block" } }));
    expect(report.messages.map((message) => [message.code, message.level])).toEqual([
      ["DIFF_COVERAGE_UNGATED", "info"],
      [CODE, "warn"],
      ["NO_AGENT_SETUP_FILES", "info"],
    ]);
    expect(report.verdict).toBe("warn");
    expect(report.testIntegrity.verdict).toBe("pass");
    expect(report.testIntegrity.signals).toEqual([]);
  });

  it("an added test file whose text was not read gives no evidence, and the unread file is named as before", () => {
    const input = caseInput("pass-added-test");
    const report = run({
      ...input,
      testSources: {
        base: { files: [], dropped: [] },
        head: { files: [], dropped: [{ path: "src/cart.test.ts", reason: "too-large" }] },
      },
    });
    expect(report.testIntegrity.exercise).toEqual({ checked: 2, notExercised: ["src/cart.ts", "src/tax.ts"] });
    expect(report.messages.map((message) => message.code)).toContain("TEST_INTEGRITY_INDEX_UNAVAILABLE");
  });
});

describe("buildReport and the tests-exercise result", () => {
  const base = { version: "0.1.0", diffCoverage: null, threshold: null, agentSetup: { files: [] } };
  const result = { checked: 3, notExercised: ["src/a.ts", "src/b.ts"] };

  it("adds the message and the field only when a file is not exercised and the mode is not off", () => {
    const made = buildReport({ ...base, testExercise: result });
    expectValidReport(made);
    expect(exerciseOf(made).map((message) => message.level)).toEqual(["warn"]);
    expect(made.testIntegrity.exercise).toEqual(result);
    for (const [label, extra] of [
      ["absent", {}],
      ["every file exercised", { testExercise: { checked: 3, notExercised: [] } }],
      ["mode off", { testExercise: result, testIntegrity: { mode: "off", source: "input" } }],
    ] as const) {
      const report = buildReport({ ...base, ...extra });
      expectValidReport(report);
      expect(exerciseOf(report), label).toEqual([]);
      expect("exercise" in report.testIntegrity, label).toBe(false);
    }
  });
});

/** The diff entry that adds one line to the source file at `path`. */
const oneLineAdded = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,0 +2 @@",
    "+export const b = 2;",
  ].join("\n");

describe("TESTS_NOT_EXERCISING_CHANGES, caps", () => {
  /** A diff that adds one line to each of `n` source files, src/f000.ts upward. */
  const manySources = (n: number) => {
    const paths = Array.from({ length: n }, (_, i) => `src/f${String(i).padStart(3, "0")}.ts`);
    const diff = paths.map(oneLineAdded).join("\n");
    return { paths, input: { ...caseInput("warn-no-test"), diff: { text: `${diff}\n` }, repoFiles: paths } };
  };

  it("names the first 10 paths, in code-unit order, then +N more", () => {
    const { paths, input } = manySources(12);
    const report = run(input);
    const [message] = exerciseOf(report);
    const named = paths
      .slice(0, 10)
      .map((path) => `\`${path}\``)
      .join(", ");
    expect(message?.text).toBe(
      `12 of 12 changed source files are not imported by a test file this change adds or modifies: ${named}, +2 more. A changed source file counts as exercised when a test file the change adds or modifies imports it directly (a relative import) and keeps or raises its assertion count.`,
    );
    expect(report.testIntegrity.exercise).toEqual({ checked: 12, notExercised: paths });
  });

  it("keeps at most 200 paths in testIntegrity.exercise and counts the rest in truncated", () => {
    const { paths, input } = manySources(205);
    const report = run(input);
    expect(report.testIntegrity.exercise).toEqual({ checked: 205, notExercised: paths.slice(0, 200), truncated: 5 });
    expect(exerciseOf(report)[0]?.text).toContain(", +195 more.");
  });

  it("quotes a path with a backtick or a control character as one code span", () => {
    const path = "src/we`ird\u0007.ts";
    const report = run({ ...caseInput("warn-no-test"), diff: { text: `${oneLineAdded(path)}\n` }, repoFiles: [path] });
    expect(exerciseOf(report)[0]?.text).toContain("`src/we'ird\uFFFD.ts`");
  });
});
