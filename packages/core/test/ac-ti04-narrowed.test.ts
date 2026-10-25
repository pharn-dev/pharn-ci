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

/** Seven narrowing forms, each at its own line, some indented; the new-file line of each is in NARROWED_AT. */
const ADDED = [
  "it.only('a', () => {", // 10
  "  expect(1).toBe(1);",
  "});",
  'test.only("b", () => {', // 13
  "  expect(2).toBe(2);",
  "});",
  "describe.only('c', () => {", // 16
  "  test.describe.only('d', () => {", // 17
  "    describe.only.each([1, 2])('e %s', (n) => {", // 18
  "      fit('f', () => {", // 19
  "        expect(n).toBeGreaterThan(0);",
  "      });",
  "    });",
  "  });",
  "});",
  "fdescribe('g', () => {", // 25
  "});",
];
const NARROWED_AT = [10, 13, 16, 17, 18, 19, 25];

describe("TI04: a narrowing marker added to a JS/TS test file", () => {
  it("AC-1: seven added .only, fit and fdescribe lines give seven block TI04 signals with one fixed detail", async () => {
    const report = await run(edit(PATH, [10, 10, [], ADDED]));
    const ti04 = report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI04");

    expect(ti04.map((s) => ({ path: s.path, line: s.line, severity: s.severity }))).toEqual(
      NARROWED_AT.map((line) => ({ path: PATH, line, severity: "block" })),
    );

    const details = new Set(ti04.map((s) => s.detail));
    expect(details.size).toBe(1);
    const [detail] = [...details] as [string];
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.length).toBeLessThanOrEqual(300);
    for (const name of ["a", "b", "c", "d", "e %s", "f", "g"]) {
      for (const quote of ["'", '"', "`"]) expect(detail, name).not.toContain(`${quote}${name}${quote}`);
    }
    expect(JSON.stringify(report)).not.toContain("it.only('a'");
  });
});
