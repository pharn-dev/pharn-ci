import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI03 and TI04 exist, so nothing the
// build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/user.test.ts";

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
  report.testIntegrity.signals
    .filter((signal) => String(signal.id) === "TI04")
    .map((signal) => ({ path: signal.path, line: signal.line, severity: signal.severity }));

describe("TI04: a marker that was already there, a renamed one, and the per-file cap", () => {
  it("AC-3: an edit to async and a move give nothing, a rename gives one signal, 21 added markers give 20", async () => {
    // `it.only('a', () => {` edited to async at the same line: the same token and name were removed.
    const toAsync = edit(PATH, [5, 5, ["it.only('a', () => {"], ["it.only('a', async () => {"]]);
    expect(ti04(await run(toAsync))).toEqual([]);

    // `describe.only('c', () => {` removed at old line 5 and added again at new line 29.
    const moved = edit(PATH, [5, 5, ["describe.only('c', () => {"], []], [30, 29, [], ["describe.only('c', () => {"]]);
    expect(ti04(await run(moved))).toEqual([]);

    // `it.only('a', () => {` edited to `it.only('b', () => {`: a new name, so a new narrowing marker.
    const renamed = edit(PATH, [5, 5, ["it.only('a', () => {"], ["it.only('b', () => {"]]);
    expect(ti04(await run(renamed))).toEqual([{ path: PATH, line: 5, severity: "block" }]);

    // 21 added markers at new lines 40 to 60: capped at 20 for the file, on the lowest line numbers.
    const many = Array.from({ length: 21 }, (_, i) => `it.only('t${i + 1}', () => {`);
    const capped = ti04(await run(edit(PATH, [40, 40, [], many])));
    expect(capped).toEqual(Array.from({ length: 20 }, (_, i) => ({ path: PATH, line: 40 + i, severity: "block" })));
  });
});
