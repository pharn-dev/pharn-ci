import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded from the package inside each test body: the AC test is written before `.spec.cts` files are
// test files by name and read as JS/TS, so nothing the build changes may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = ["package.json", "src/cart.ts", "src/cart.cts", "src/cart.test.ts", "src/cart.spec.cts"];

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

/** The same change on any path: `.skip` added to the existing test at line 12. */
const skipExisting = (path: string) =>
  edit(path, [12, 12, ["  it('adds an item', () => {"], ["  it.skip('adds an item', () => {"]]);

async function ti03(path: string): Promise<Signal[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: skipExisting(path) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report.testIntegrity.signals as unknown as Signal[]).filter((s) => String(s.id) === "TI03");
}

describe("check(): TI03 in a .spec.cts test file", () => {
  it("AC-3: adding .skip to an existing test of src/cart.spec.cts gives a TI03 signal naming it at the severity the same change to src/cart.test.ts gives", async () => {
    const baseline = await ti03("src/cart.test.ts");
    expect(baseline, "the src/cart.test.ts change gives one TI03").toHaveLength(1);
    const reference = baseline[0] as Signal;

    const signals = await ti03("src/cart.spec.cts");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.path).toBe("src/cart.spec.cts");
    expect(signals[0]?.severity).toBe(reference.severity);
    expect(signals[0]?.line).toBe(reference.line);
  });
});
