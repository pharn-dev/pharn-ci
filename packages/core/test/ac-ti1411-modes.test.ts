import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI14 and TI11 exist, so nothing the
// build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CONFIG = ".pharn/ci.yml";
const CI = ".github/workflows/ci.yml";
const TEST_FILE = "src/__tests__/b.test.ts";

function hunk(start: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${start - 1},0` : `${start},${removed.length}`;
  const newPart = added.length === 0 ? `${start - 1},0` : `${start},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, hunks: Array<[number, string[], string[]]>): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap(([start, removed, added]) => hunk(start, removed, added))].join("\n")}\n`;
}

function removeFile(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "deleted file mode 100644", "index 1111111..0000000 100644"];
  const body = [`--- a/${path}`, "+++ /dev/null", `@@ -1,${lines.length} +0,0 @@`, ...lines.map((l) => `-${l}`)];
  return `${[...head, ...body].join("\n")}\n`;
}

/** Lowers the threshold, deletes a test file whose source stays, drops a pull_request trigger, adds continue-on-error. */
const DIFF =
  edit(CONFIG, [[3, ["  threshold: 80"], ["  threshold: 70"]]]) +
  removeFile(TEST_FILE, ["it('b', () => {", "  expect(1).toBe(1);", "});"]) +
  edit(CI, [
    [5, ["  pull_request:"], []],
    [12, [], ["        continue-on-error: true"]],
  ]);

async function run(mode: "block" | "warn" | "off") {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

type Report = Awaited<ReturnType<typeof run>>;

const summary = (report: Report) =>
  report.testIntegrity.signals.map((s) => `${s.id} ${s.severity} ${s.path}${s.line === null ? "" : `:${s.line}`}`);
const levels = (report: Report, code: string) =>
  report.messages.filter((m) => (m.code as string) === code).map((m) => m.level);

describe("TI14 and TI11 in the three modes", () => {
  it("AC-12: block mode sorts the signals and raises the verdict, warn mode shows every signal as warn, off computes nothing", async () => {
    const block = await run("block");
    expect(summary(block)).toEqual([
      `TI01 block ${TEST_FILE}`,
      `TI11 block ${CI}:5`,
      `TI11 warn ${CI}:12`,
      `TI14 block ${CONFIG}:3`,
    ]);
    expect(block.testIntegrity.verdict).toBe("fail");
    expect(levels(block, "TEST_INTEGRITY_TI01")).toEqual(["error"]);
    expect(levels(block, "TEST_INTEGRITY_TI11")).toEqual(["error"]);
    expect(levels(block, "TEST_INTEGRITY_TI14")).toEqual(["error"]);
    expect(levels(block, "CONFIG_CHANGED_IN_DIFF")).toEqual(["warn"]);
    expect(block.testIntegrity.languages).toEqual([]);

    const warn = await run("warn");
    expect(summary(warn)).toEqual([
      `TI01 warn ${TEST_FILE}`,
      `TI11 warn ${CI}:5`,
      `TI11 warn ${CI}:12`,
      `TI14 warn ${CONFIG}:3`,
    ]);
    expect(warn.testIntegrity.verdict).toBe("warn");
    for (const code of ["TEST_INTEGRITY_TI01", "TEST_INTEGRITY_TI11", "TEST_INTEGRITY_TI14"]) {
      expect(levels(warn, code), code).toEqual(["warn"]);
    }

    const off = await run("off");
    expect(off.testIntegrity.signals).toEqual([]);
    expect(off.testIntegrity.verdict).toBe("pass");
    for (const code of ["TEST_INTEGRITY_TI01", "TEST_INTEGRITY_TI11", "TEST_INTEGRITY_TI14"]) {
      expect(levels(off, code), code).toEqual([]);
    }
    expect(levels(off, "CONFIG_CHANGED_IN_DIFF")).toEqual(["warn"]);
  });
});
