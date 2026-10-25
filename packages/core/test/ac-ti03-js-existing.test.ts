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

async function run(diff: string, mode: "block" | "warn") {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti03 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI03");

/** A test-opening line removed and added again with a skip, the test name kept (by content). */
const SKIPPED: Array<[string, string]> = [
  ["it('creates a user', () => {", "it.skip('creates a user', () => {"],
  ['it("creates a user", () => {', "it.skip('creates a user', () => {"],
  ["test('n', () => {", "test.todo('n')"],
  ["describe('s', () => {", "xdescribe('s', () => {"],
  ["it('n', () => {", "xit('n', () => {"],
  ["test.describe('s', () => {", "test.describe.skip('s', () => {"],
  ["it('n', () => {", "it.fails('n', () => {"],
  ["it('n', () => {", "it.skipIf(true)('n', () => {"],
  ["it('n', () => {", "it.runIf(false)('n', () => {"],
];

describe("TI03: an unconditional skip on a test the diff shows existed", () => {
  it("AC-4: each JS/TS skip of an existing test is one TI03 signal, block in mode block and warn in mode warn", async () => {
    const details = new Set<string>();
    for (const mode of ["block", "warn"] as const) {
      for (const [removed, added] of SKIPPED) {
        const label = `${mode}: ${removed} -> ${added}`;
        const signals = ti03(await run(edit(PATH, [12, 12, [removed], [added]]), mode));
        expect(signals, label).toHaveLength(1);
        expect(signals[0], label).toMatchObject({ path: PATH, line: 12, severity: mode });
        details.add(signals[0]?.detail ?? "");
      }
    }
    // One fixed sentence for the category, in both modes: the "unconditional skip on an existing test" sentence.
    expect(details.size).toBe(1);
    const [detail] = [...details] as [string];
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(detail).toMatch(/unconditional/i);
    expect(detail).not.toContain("creates a user");
  });
});
