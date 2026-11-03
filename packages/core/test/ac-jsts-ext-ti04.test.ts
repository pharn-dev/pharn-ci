import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded from the package inside each test body: the AC test is written before `.test.mts` files are
// read as JS/TS test files, so nothing the build changes may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.mts";
const REPO_FILES = ["package.json", "src/cart.mts", PATH];

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}

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

describe("check(): TI04 in a .test.mts test file", () => {
  it("AC-2: turning it( into it.only( on an existing test of src/cart.test.mts gives a TI04 block signal naming that file and line", async () => {
    const { check } = await import("@pharn-ci/core");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: edit(PATH, [12, 12, ["  it('adds an item', () => {"], ["  it.only('adds an item', () => {"]]) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: REPO_FILES,
      testIntegrityMode: { input: "block" },
    } as Parameters<typeof check>[0]);
    expectValidReport(report);

    const signals = (report.testIntegrity.signals as unknown as Signal[]).filter((s) => String(s.id) === "TI04");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.severity).toBe("block");
    expect(signals[0]?.path).toBe(PATH);
    expect(signals[0]?.line).toBe(12);
  });
});
