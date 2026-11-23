import { describe, expect, it } from "vitest";
import type { Report, TestIntegrityMode } from "../src/report.js";
import type { PythonTestIndex } from "../src/testIndex/pythonSides.js";
import type { TestSourceDrop, TestSourceObject } from "../src/testSources.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-13). The inputs of AC-11 (TypeScript) and AC-12 (Python) in mode warn: 34 modified test files whose
// read plan, computed from object sizes, drops the 34th in path order as over-total-cap on the head side while its base
// is read; the diff removes a test from it. In mode warn the TEST_INTEGRITY_INDEX_UNAVAILABLE message stays a warning,
// which already holds today, so each test also runs the same inputs in mode block as its control, which must give the
// error AC-11 and AC-12 ask for. The Python half uses a stubbed index built from the kept files (AC-12 runs the real
// interpreter). planTestSourceReads and check() are loaded inside the test bodies: the AC test is written before the
// build, so nothing the build changes may run while the file loads.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const COUNT = 34;

interface Language {
  paths: string[];
  dropped: string;
  base: string;
  headTouched: string;
  headRemoved: string;
  diff: string;
  index?: (head: Side, base: Side) => PythonTestIndex;
}

type Side = { files: { path: string; text: string }[]; dropped: TestSourceDrop[] };

function modified(path: string, body: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    ...body,
  ].join("\n");
}

const TS_LINES = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
];
const TS_PATHS = Array.from({ length: COUNT }, (_, i) => `src/t${String(i).padStart(2, "0")}.test.ts`);
const TS: Language = {
  paths: TS_PATHS,
  dropped: "src/t33.test.ts",
  base: `${TS_LINES.join("\n")}\n`,
  headTouched: `${[...TS_LINES.slice(0, 5), "  expect(total([1])).toBe(1);", ...TS_LINES.slice(5)].join("\n")}\n`,
  headRemoved: `${TS_LINES.slice(0, 6).join("\n")}\n`,
  diff: `${TS_PATHS.map((path) =>
    modified(
      path,
      path === "src/t33.test.ts"
        ? ["@@ -7,4 +6,0 @@", "-", `-${TS_LINES[7]}`, `-${TS_LINES[8]}`, `-${TS_LINES[9]}`]
        : ["@@ -5,0 +6 @@", "+  expect(total([1])).toBe(1);"],
    ),
  ).join("\n")}\n`,
};

const PY_LINES = [
  "from cart import total",
  "",
  "",
  "def test_adds():",
  "    assert total([2, 3]) == 5",
  "",
  "",
  "def test_empty():",
  "    assert total([]) == 0",
];
const PY_PATHS = Array.from({ length: COUNT }, (_, i) => `tests/test_${String(i).padStart(2, "0")}.py`);
const parsed = (path: string) => ({ path, result: { parsed: true as const, syntaxErrors: 0, tests: [], mocks: [] } });
const PY: Language = {
  paths: PY_PATHS,
  dropped: "tests/test_33.py",
  base: `${PY_LINES.join("\n")}\n`,
  headTouched: `${[...PY_LINES.slice(0, 5), "    assert total([1]) == 1", ...PY_LINES.slice(5)].join("\n")}\n`,
  headRemoved: `${PY_LINES.slice(0, 5).join("\n")}\n`,
  diff: `${PY_PATHS.map((path) =>
    modified(
      path,
      path === "tests/test_33.py"
        ? ["@@ -6,4 +5,0 @@", "-", "-", `-${PY_LINES[7]}`, `-${PY_LINES[8]}`]
        : ["@@ -5,0 +6 @@ def test_adds():", "+    assert total([1]) == 1"],
    ),
  ).join("\n")}\n`,
  // The stub stands for an index that ran over the kept files and read each of them.
  index: (head, base) => ({
    available: true,
    base: base.files.map((f) => parsed(f.path)),
    head: head.files.map((f) => parsed(f.path)),
  }),
};

async function run(language: Language, mode: TestIntegrityMode): Promise<Report> {
  const { planTestSourceReads } = await import("../src/testSources.js");
  const objects = (size: number) =>
    new Map<string, TestSourceObject | null>(language.paths.map((path) => [path, { type: "blob", size }]));
  const side = (size: number, text: (path: string) => string): Side => {
    const plan = planTestSourceReads(language.paths, objects(size));
    return { files: plan.read.map((path) => ({ path, text: text(path) })), dropped: plan.dropped };
  };
  const base = side(400_000, () => language.base);
  const head = side(500_000, (path) => (path === language.dropped ? language.headRemoved : language.headTouched));
  expect(head.dropped, "the head plan drops only the 34th file, as over-total-cap").toEqual([
    { path: language.dropped, reason: "over-total-cap" },
  ]);
  expect(base.dropped, "the base plan reads every file").toEqual([]);

  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: language.diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [...language.paths, "src/app.ts", "src/cart.ts"].sort(),
    testIntegrityMode: { input: mode },
    testSources: { base, head },
    ...(language.index === undefined ? {} : { pythonTestIndex: language.index(head, base) }),
  });
  expectValidReport(report);
  return report;
}

function expectWarnOnly(language: Language, warn: Report): void {
  const naming = warn.messages.filter((m) => m.code === CODE && m.text.includes(`\`${language.dropped}\``));
  expect(naming, `one ${CODE} message names ${language.dropped}`).toHaveLength(1);
  expect(naming[0]?.text, "it names the file with over-total-cap").toContain(
    `\`${language.dropped}\` (\`over-total-cap\`)`,
  );
  expect(naming[0]?.level, "the message is a warning in mode warn").toBe("warn");
  expect(
    warn.messages.filter((m) => m.level === "error" && m.text.includes(language.dropped)),
    "no error message names the dropped file",
  ).toEqual([]);
  expect(
    warn.testIntegrity.signals.filter((s) => s.severity === "block" && s.path === language.dropped),
    "no block-level signal on the dropped file",
  ).toEqual([]);
  expect(warn.verdict, "the dropped file does not fail the run").not.toBe("fail");
}

function expectBlockControl(language: Language, block: Report): void {
  const naming = block.messages.filter((m) => m.code === CODE && m.text.includes(`\`${language.dropped}\``));
  expect(
    naming.map((m) => m.level),
    "control: mode block on the same inputs gives the error",
  ).toEqual(["error"]);
}

describe("CORE-351: in mode warn a test file dropped past the 16 MiB total stays a warning", () => {
  it("AC-13: the TypeScript inputs of AC-11 in mode warn give the TEST_INTEGRITY_INDEX_UNAVAILABLE warning naming src/t33.test.ts with over-total-cap and nothing at an error or block level for it (mode block is the error control)", async () => {
    expectBlockControl(TS, await run(TS, "block"));
    expectWarnOnly(TS, await run(TS, "warn"));
  });

  it("AC-13: the Python inputs of AC-12 in mode warn give the TEST_INTEGRITY_INDEX_UNAVAILABLE warning naming tests/test_33.py with over-total-cap and nothing at an error or block level for it (mode block is the error control)", async () => {
    expectBlockControl(PY, await run(PY, "block"));
    expectWarnOnly(PY, await run(PY, "warn"));
  });
});
