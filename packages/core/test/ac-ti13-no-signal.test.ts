import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI13 exists, so nothing the build adds
// may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = [
  "README.md",
  "docs/coverage.md",
  "lib/d.cts",
  "src/a.test.ts",
  "src/a.ts",
  "test/helpers.ts",
  "tests/test_run.py",
  "tools/run.py",
];

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

async function run(diff: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti13 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI13");

const ISTANBUL = "/* istanbul ignore next */";
const PRAGMA = "# pragma: no cover";
const add = (path: string, line: string) => edit(path, [12, 12, [], [line]]);

const CASES: Array<[label: string, diff: string]> = [
  [
    "the istanbul hint moved within src/a.ts, other indentation",
    edit("src/a.ts", [5, 5, [ISTANBUL], []], [21, 20, [], [`    ${ISTANBUL}`]]),
  ],
  [
    "a pragma: no cover line moved within tools/run.py",
    edit("tools/run.py", [4, 4, [`if DEBUG:  ${PRAGMA}`], []], [10, 9, [], [`if DEBUG:  ${PRAGMA}`]]),
  ],
  ["a c8 hint removed", edit("lib/d.cts", [7, 7, ["/* c8 ignore next */"], []])],
  ["the istanbul hint in the test file src/a.test.ts", add("src/a.test.ts", ISTANBUL)],
  ["the istanbul hint in the test file test/helpers.ts", add("test/helpers.ts", ISTANBUL)],
  ["pragma: no cover in the test file tests/test_run.py", add("tests/test_run.py", `    return x  ${PRAGMA}`)],
  ["the istanbul hint in a Python file", add("tools/run.py", ISTANBUL)],
  ["pragma: no cover in a TypeScript file", add("src/a.ts", PRAGMA)],
  ["the istanbul hint in README.md", add("README.md", ISTANBUL)],
  ["the istanbul hint in docs/coverage.md", add("docs/coverage.md", ISTANBUL)],
  ["the marker words inside a string", add("src/a.ts", 'const s = "istanbul ignore next";')],
  ["another tool's comment", add("src/a.ts", "/* eslint-disable */")],
  ["ignored is not ignore", add("src/a.ts", "// v8 ignored on purpose")],
  ["pragma: no branch is not no cover", add("tools/run.py", "x = 1  # pragma: no branch")],
];

describe("TI13: comments and edits that add no coverage-ignore marker to source", () => {
  it("AC-7: moved and removed markers, markers in test files, markdown or the other language, and look-alikes give no TI13", async () => {
    // Control: the marker these cases stay clear of gives a TI13 signal in a non-test source file.
    const control = await run(add("src/a.ts", ISTANBUL));
    expect(ti13(control).map((s) => `${s.path}:${s.line}`)).toEqual(["src/a.ts:12"]);

    for (const [label, diff] of CASES) {
      const report = await run(diff);
      expect(ti13(report), label).toEqual([]);
    }
  });
});
