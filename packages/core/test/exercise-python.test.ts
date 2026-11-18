import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import * as exercise from "../src/signals/exercise.js";
import { indexTouchedTestFiles } from "../src/signals/testPairs.js";
import { pythonIndexFromRaw } from "../src/testIndex/pythonRaw.js";

// CORE-104 (R3.8): the parts below check() that let TESTS_NOT_EXERCISING_CHANGES cover Python: the mapping of a Python
// module name to the changed source paths it can mean, the optional `imports` field of the raw Python index output,
// and the evidence rule. The end-to-end cases (real python3, fixtures/exercise/py-*) are in
// packages/node-io/test/ac-py-exercise.test.ts.

const none = () => false;
const HUNK = ["@@ -0,0 +1 @@", "+X = 1"];
const added = (path: string) => [
  `diff --git a/${path} b/${path}`,
  "new file mode 100644",
  "index 0000000..2222222",
  "--- /dev/null",
  `+++ b/${path}`,
  ...HUNK,
];
const diffOf = (...entries: string[][]) => parseUnifiedDiff(`${entries.flat().join("\n")}\n`);

describe("pythonModulePaths: a module name to the paths it can mean", () => {
  it("AC-4: maps an absolute name to the .py file and the package __init__.py at the root and under src/, and a relative name from the test's directory", () => {
    const map = exercise.pythonModulePaths;
    expect(map("tests/test_billing.py", "pkg.billing")).toEqual([
      "pkg/billing.py",
      "pkg/billing/__init__.py",
      "src/pkg/billing.py",
      "src/pkg/billing/__init__.py",
    ]);
    expect(map("tests/test_billing.py", "billing")).toEqual([
      "billing.py",
      "billing/__init__.py",
      "src/billing.py",
      "src/billing/__init__.py",
    ]);
    // One dot is the test's own directory; each extra dot one level up.
    expect(map("src/pkg/test_billing.py", ".billing")).toEqual(["src/pkg/billing.py", "src/pkg/billing/__init__.py"]);
    expect(map("src/pkg/tests/test_billing.py", "..billing")).toEqual([
      "src/pkg/billing.py",
      "src/pkg/billing/__init__.py",
    ]);
    expect(map("src/pkg/tests/test_billing.py", "..sub.mod.x")).toEqual([
      "src/pkg/sub/mod/x.py",
      "src/pkg/sub/mod/x/__init__.py",
    ]);
    expect(map("test_billing.py", ".billing"), "a test at the root").toEqual(["billing.py", "billing/__init__.py"]);
    expect(map("a/test_x.py", "..billing"), "up to the root, not above it").toEqual([
      "billing.py",
      "billing/__init__.py",
    ]);
    // A name that climbs above the root resolves to nothing.
    expect(map("test_billing.py", "..billing")).toEqual([]);
    expect(map("a/test_x.py", "...billing")).toEqual([]);
    expect(map("a/b/test_x.py", "....pkg")).toEqual([]);
    // A malformed name (never written by the index, refused here all the same) resolves to nothing.
    for (const name of ["", "a..b", "a.", "a/b", "a\\b"]) expect(map("tests/test_x.py", name), name).toEqual([]);
  });
});

describe("the raw Python index output: the optional imports field", () => {
  const entry = (extra: Record<string, unknown>) =>
    JSON.stringify([{ id: 0, parsed: true, normalized: "", tests: [], mocks: [], ...extra }]);

  it("AC-5: is mapped beside each result when present, and absent otherwise; a wrong one is bad-output", () => {
    const mapped = pythonIndexFromRaw(entry({ imports: ["pkg.billing", ".sibling"] }), 1) as unknown as {
      available: boolean;
      results: unknown[];
      imports?: Array<string[] | undefined>;
    };
    expect(mapped.available).toBe(true);
    expect(mapped.results).toEqual([{ parsed: true, syntaxErrors: 0, tests: [], mocks: [] }]);
    expect(mapped.imports).toEqual([["pkg.billing", ".sibling"]]);
    const without = pythonIndexFromRaw(entry({}), 1) as unknown as { imports?: unknown[] };
    expect(without.imports).toEqual([undefined]);

    const cases: Array<[unknown, string]> = [
      ["pkg", "imports is not an array"],
      [[1], "import is not a string"],
      [[""], "import is empty"],
      [["a".repeat(501)], "import is longer than 500"],
      [Array.from({ length: 1001 }, (_, i) => `m${i}`), "imports is longer than 1000"],
    ];
    for (const [imports, detail] of cases) {
      expect(pythonIndexFromRaw(entry({ imports }), 1), detail).toEqual({
        available: false,
        reason: "bad-output",
        detail: `entry 0: ${detail}`,
      });
    }
    expect(pythonIndexFromRaw(entry({ imports: ["a".repeat(500)] }), 1).available, "500 characters is kept").toBe(true);
    expect(
      pythonIndexFromRaw(JSON.stringify([{ id: 0, parsed: false, reason: "too-deep", imports: [] }]), 1).available,
      "a refused entry carries no imports",
    ).toBe(false);
  });
});

describe("detectUnexercisedChanges on Python", () => {
  const py = (path: string, text: string) => ({ path, text });
  const sources = (head: Array<{ path: string; text: string }>) => ({
    base: { files: [], dropped: [] },
    head: { files: head, dropped: [] },
  });
  const testText = "import pkg.billing\n\ndef test_total():\n    assert pkg.billing.X == 1\n";
  const pythonIndex = (imports: string[] | undefined, assertionCount = 1) => ({
    available: true as const,
    base: [],
    head: [
      {
        path: "tests/test_billing.py",
        result: {
          parsed: true as const,
          syntaxErrors: 0,
          tests: [
            {
              kind: "test" as const,
              name: "test_total",
              nameDynamic: false,
              path: ["test_total"],
              line: 3,
              endLine: 4,
              modifiers: [],
              body: "",
              bodyHash: "0",
              assertionCount,
              assertions: [],
              guards: [],
            },
          ],
          mocks: [],
        },
        ...(imports === undefined ? {} : { imports }),
      },
    ],
  });

  it("AC-6: a Python test file's imports exercise the Python source they map to; a JS/TS import of a .py path does not; with python false Python sources are not asked", () => {
    const diff = diffOf(added("src/pkg/billing.py"), added("tests/test_billing.py"));
    const touched = (imports: string[] | undefined, assertions = 1) =>
      indexTouchedTestFiles(
        diff,
        sources([py("tests/test_billing.py", testText)]),
        pythonIndex(imports, assertions) as never,
      );
    const detect = exercise.detectUnexercisedChanges;
    // Control: a test that imports another module leaves the source not exercised.
    expect(detect(diff, touched(["pkg.other"]), [], none)).toEqual({
      checked: 1,
      notExercised: ["src/pkg/billing.py"],
    });
    expect(detect(diff, touched(["pkg.billing"]), [], none)).toEqual({ checked: 1, notExercised: [] });
    expect(detect(diff, touched([".billing"]), [], none), "a relative name from tests/ means tests/billing.py").toEqual(
      {
        checked: 1,
        notExercised: ["src/pkg/billing.py"],
      },
    );
    expect(detect(diff, touched(["pkg.billing"], 0), [], none), "a test file with no assertion").toEqual({
      checked: 1,
      notExercised: ["src/pkg/billing.py"],
    });
    expect(detect(diff, touched(undefined), [], none), "a file that imports nothing").toEqual({
      checked: 1,
      notExercised: ["src/pkg/billing.py"],
    });
    expect(detect(diff, touched(["pkg.billing"]), [], none, false), "python false").toBeNull();
    expect(exercise.exerciseCandidates(diff, none, false)).toEqual([]);
    expect(exercise.exerciseCandidates(diff, none)).toEqual(["src/pkg/billing.py"]);

    // A JS/TS test that names the .py file gives no evidence for it.
    const jsDiff = diffOf(added("src/pkg/billing.py"), added("src/pkg/billing.test.ts"));
    const jsText = 'import "./billing.py";\nit("b", () => {\n  expect(1).toBe(1);\n});\n';
    const jsTouched = indexTouchedTestFiles(
      jsDiff,
      sources([{ path: "src/pkg/billing.test.ts", text: jsText }]),
      undefined,
    );
    expect(detect(jsDiff, jsTouched, ["src/pkg/billing.py"], none)).toEqual({
      checked: 1,
      notExercised: ["src/pkg/billing.py"],
    });
  });
});
