import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI13 exists, so nothing the build adds
// may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = [
  "package.json",
  "src/a.ts",
  "src/a.test.ts",
  "src/b.mts",
  "src/c.jsx",
  "lib/d.cts",
  "lib/e.js",
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

/** A file the diff adds (status added). */
function addFile(path: string, lines: string[]): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    `+++ b/${path}`,
  ];
  return `${[...head, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

async function run(diff: string, mode: "block" | "warn") {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

/** Each case adds one line at line 12 of a modified non-test source file. */
const ADDED: Array<[path: string, line: string]> = [
  ["src/a.ts", "/* istanbul ignore next */"],
  ["src/a.ts", "// istanbul ignore next"],
  ["src/a.ts", "/* istanbul ignore else */"],
  ["src/a.ts", "export default /* istanbul ignore next */ function f() {}"],
  ["src/b.mts", "/* v8 ignore next 3 */"],
  ["src/c.jsx", "/* v8 ignore start */"],
  ["lib/d.cts", "/* c8 ignore stop */"],
  ["lib/e.js", "// c8 ignore next"],
  ["tools/run.py", "    return x  # pragma: no cover"],
  ["tools/run.py", "if DEBUG:  # pragma: no cover"],
  ["tools/run.py", "#pragma:no cover"],
];

type Case = { label: string; diff: string; path: string; line: number };

const CASES: Case[] = [
  ...ADDED.map(([path, line]) => ({
    label: `${path}: ${line}`,
    diff: edit(path, [12, 12, [], [line]]),
    path,
    line: 12,
  })),
  {
    label: "src/new.ts added with the istanbul hint",
    diff: addFile("src/new.ts", ["/* istanbul ignore next */", "export function f() {", "  return 1;", "}"]),
    path: "src/new.ts",
    line: 1,
  },
];

describe("TI13: a coverage-ignore comment added to source", () => {
  it("AC-6: each added istanbul, v8, c8 or pragma: no cover comment gives one TI13 signal at its line with the mode's severity", async () => {
    for (const mode of ["block", "warn"] as const) {
      for (const c of CASES) {
        const report = await run(c.diff, mode);
        const ti13 = report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI13");
        expect(
          ti13.map((s) => ({ path: s.path, line: s.line, severity: s.severity })),
          `${mode}: ${c.label}`,
        ).toEqual([{ path: c.path, line: c.line, severity: mode }]);
      }
    }
  });
});
