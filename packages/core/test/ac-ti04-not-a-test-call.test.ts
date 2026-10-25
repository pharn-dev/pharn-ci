import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI03 and TI04 exist, so nothing the
// build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

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
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti04 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI04");

/** Added lines that are not a narrowing test call, by path. */
const QUIET: Array<[string, string]> = [
  ["src/user.test.ts", "solver.fit(x)"],
  ["src/user.test.ts", "model.fit(x)"],
  ["src/user.test.ts", "const r = fit(a)"],
  ["src/user.test.ts", "expect(foo.only(1))"],
  ["src/user.test.ts", "// it.only('x', () => {})"],
  ["tests/test_model.py", "def fit(self):"],
  ["tests/test_model.py", "it.only('x')"],
  ["pkg/model_test.go", "fit("],
  ["src/util.ts", "it.only('x', () => {"],
  ["tests/fixtures/data.json", "it.only('x', () => {"],
];

describe("TI04: lines that only look like a narrowing marker", () => {
  it("AC-2: method calls, assignments, comments, Python, Go, non-test and JSON files give no TI04 signal", async () => {
    // Control: the same file with a real `it.only(` at the start of a line is a TI04 signal, so the quiet cases
    // below are quiet because of what they hold, not because TI04 never fires.
    const control = ti04(await run(edit("src/user.test.ts", [8, 8, [], ["it.only('x', () => {"]])));
    expect(control).toHaveLength(1);
    expect(control[0]).toMatchObject({ path: "src/user.test.ts", line: 8, severity: "block" });

    for (const [path, line] of QUIET) {
      expect(ti04(await run(edit(path, [8, 8, [], [line]]))), `${path}: ${line}`).toEqual([]);
      expect(ti04(await run(edit(path, [8, 8, [], [`  ${line}`]]))), `${path}: indented ${line}`).toEqual([]);
    }

    // All of them together in one diff, one file section per path.
    const byPath = new Map<string, string[]>();
    for (const [path, line] of QUIET) byPath.set(path, [...(byPath.get(path) ?? []), line]);
    const together = [...byPath].map(([path, lines]) => edit(path, [20, 20, [], lines])).join("");
    expect(ti04(await run(together))).toEqual([]);
  });
});
