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

const ti03 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI03");

const JS = "src/user.test.ts";
const PY = "tests/test_user.py";
const GO = "pkg/net_test.go";

/** Diffs that must give no TI03 signal. */
const QUIET: Array<[string, string]> = [
  ["it.fails edited from sync to async", edit(JS, [5, 5, ["it.fails('n', () => {"], ["it.fails('n', async () => {"]])],
  [
    "it.skip moved within its file",
    edit(JS, [5, 5, ["it.skip('n', () => {"], []], [30, 29, [], ["it.skip('n', () => {"]]),
  ],
  [
    "a skip decorator moved within its file",
    edit(PY, [5, 5, ['@pytest.mark.skip(reason="x")'], []], [30, 29, [], ['@pytest.mark.skip(reason="x")']]),
  ],
  ["t.Skip moved within its file", edit(GO, [5, 5, ['\tt.Skip("x")'], []], [30, 29, [], ['\tt.Skip("x")']])],
  ["it.skip respelled as xit", edit(JS, [5, 5, ["it.skip('n', () => {"], ["xit('n', () => {"]])],
  ["it.skipIf(false) in place of it", edit(JS, [5, 5, ["it('n', () => {"], ["it.skipIf(false)('n', () => {"]])],
  ["it.runIf(true) in place of it", edit(JS, [5, 5, ["it('n', () => {"], ["it.runIf(true)('n', () => {"]])],
  ["test.fixme added", edit(JS, [5, 5, [], ["test.fixme('n', () => {"]])],
  ["a commented-out it.skip", edit(JS, [5, 5, [], ["// it.skip('x')"]])],
  ["a commented-out skip decorator", edit(PY, [5, 5, [], ["# @pytest.mark.skip"]])],
  ["a string line holding it.skip", edit(JS, [5, 5, [], [`"it.skip('x')",`]])],
  ["a conditional skip in a non-test file", edit("src/util.ts", [5, 5, [], ['test.skip(isMobile, "x")']])],
];

describe("TI03: edits that keep a skip, non-skips, comments, strings and non-test files", () => {
  it("AC-9: none of these diffs gives a TI03 signal", async () => {
    // Control: an existing `it('n'` turned into `it.skip('n'` in the same file is a TI03 signal, so the quiet cases
    // below are quiet because of what they hold, not because TI03 never fires.
    const control = ti03(await run(edit(JS, [5, 5, ["it('n', () => {"], ["it.skip('n', () => {"]])));
    expect(control).toHaveLength(1);
    expect(control[0]).toMatchObject({ path: JS, line: 5, severity: "block" });

    for (const [label, diff] of QUIET) {
      expect(ti03(await run(diff)), label).toEqual([]);
    }
  });
});
