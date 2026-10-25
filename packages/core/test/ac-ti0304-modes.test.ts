import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI03 and TI04 exist, so nothing the
// build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const JS = "src/user.test.ts";
const E2E = "e2e/login.spec.ts";

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

async function run(diff: string, mode: "block" | "warn" | "off") {
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

type Report = Awaited<ReturnType<typeof run>>;

const CONDITIONAL = edit(E2E, [7, 7, [], ['  test.skip(isMobile, "x")']]);

/** An existing test skipped and an `it.only` added in one file (listed first), a conditional skip in another. */
const DIFF =
  edit(
    JS,
    [12, 12, ["it('creates a user', () => {"], ["it.skip('creates a user', () => {"]],
    [30, 30, [], ["it.only('a', () => {"]],
  ) + CONDITIONAL;

const ours = (report: Report) =>
  report.testIntegrity.signals
    .filter((s) => String(s.id) === "TI03" || String(s.id) === "TI04")
    .map((s) => `${s.id} ${s.severity} ${s.path}:${s.line}`);
const levels = (report: Report, code: string) =>
  report.messages.filter((m) => (m.code as string) === code).map((m) => m.level);

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe("TI03 and TI04 in the three modes", () => {
  it("AC-11: block sorts and fails, warn shows every signal as warn, off computes nothing, a conditional skip alone warns", async () => {
    const block = await run(DIFF, "block");
    expect(ours(block)).toEqual([`TI03 warn ${E2E}:7`, `TI03 block ${JS}:12`, `TI04 block ${JS}:30`]);
    const sorted = [...block.testIntegrity.signals].sort(
      (a, b) =>
        byCodeUnit(String(a.id), String(b.id)) ||
        byCodeUnit(a.path, b.path) ||
        (a.line ?? -1) - (b.line ?? -1) ||
        byCodeUnit(a.detail, b.detail),
    );
    expect(block.testIntegrity.signals).toEqual(sorted);
    expect(block.testIntegrity.verdict).toBe("fail");
    expect(levels(block, "TEST_INTEGRITY_TI03")).toEqual(["error"]);
    expect(levels(block, "TEST_INTEGRITY_TI04")).toEqual(["error"]);

    const warn = await run(DIFF, "warn");
    expect(ours(warn)).toEqual([`TI03 warn ${E2E}:7`, `TI03 warn ${JS}:12`, `TI04 warn ${JS}:30`]);
    expect(warn.testIntegrity.signals.every((s) => s.severity === "warn")).toBe(true);
    expect(warn.testIntegrity.verdict).toBe("warn");
    expect(levels(warn, "TEST_INTEGRITY_TI03")).toEqual(["warn"]);
    expect(levels(warn, "TEST_INTEGRITY_TI04")).toEqual(["warn"]);

    const off = await run(DIFF, "off");
    expect(ours(off)).toEqual([]);
    expect(levels(off, "TEST_INTEGRITY_TI03")).toEqual([]);
    expect(levels(off, "TEST_INTEGRITY_TI04")).toEqual([]);
    expect(off.testIntegrity.verdict).toBe("pass");

    const alone = await run(CONDITIONAL, "block");
    expect(ours(alone)).toEqual([`TI03 warn ${E2E}:7`]);
    expect(alone.testIntegrity.verdict).toBe("warn");
    expect(levels(alone, "TEST_INTEGRITY_TI03")).toEqual(["warn"]);
    expect(levels(alone, "TEST_INTEGRITY_TI04")).toEqual([]);
  });
});
