import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI10 exists, so nothing the build adds
// may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = ["package.json", "packages/api/package.json", "src/a.ts", "src/a.test.ts"];

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
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

/** The nine weakened values of a `test*` script, each replacing `vitest run`. */
const WEAKENED = [
  "vitest run || true",
  "echo skipped",
  "vitest run; echo done",
  "vitest run || echo failed",
  "vitest run; exit 0",
  "vitest run --passWithNoTests",
  "jest --testPathPattern=src/a",
  "vitest run -t adds",
  "jest --testNamePattern=adds",
];

type Case = { label: string; diff: string; path: string; line: number };

const CASES: Case[] = [
  ...WEAKENED.map((value) => ({
    label: `package.json test: ${value}`,
    diff: edit("package.json", [7, 7, ['    "test": "vitest run",'], [`    "test": "${value}",`]]),
    path: "package.json",
    line: 7,
  })),
  ...WEAKENED.map((value) => ({
    label: `packages/api/package.json test:unit: ${value}`,
    diff: edit("packages/api/package.json", [
      9,
      9,
      ['    "test:unit": "vitest run",'],
      [`    "test:unit": "${value}",`],
    ]),
    path: "packages/api/package.json",
    line: 9,
  })),
  {
    label: "pretest removed",
    diff: edit("package.json", [5, 5, ['    "pretest": "pnpm lint",'], []]),
    path: "package.json",
    line: 5,
  },
  {
    label: "posttest removed",
    diff: edit("package.json", [8, 8, ['    "posttest": "pnpm audit",'], []]),
    path: "package.json",
    line: 8,
  },
];

describe("TI10: a test script in package.json weakened", () => {
  it("AC-2: each weakening of a test* script, and each removed pretest or posttest, gives one TI10 signal at its line with the mode's severity", async () => {
    for (const mode of ["block", "warn"] as const) {
      for (const c of CASES) {
        const report = await run(c.diff, mode);
        const ti10 = report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI10");
        expect(
          ti10.map((s) => ({ path: s.path, line: s.line, severity: s.severity })),
          `${mode}: ${c.label}`,
        ).toEqual([{ path: c.path, line: c.line, severity: mode }]);
      }
    }
  });
});
