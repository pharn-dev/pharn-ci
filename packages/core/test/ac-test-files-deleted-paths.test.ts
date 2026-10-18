import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before the deleted-test-file
// message and fixtures/test-files-deleted/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_FILES_DELETED";

const SEVEN = [
  "lib/seven.test.mjs",
  "packages/a/test/one.ts",
  "src/__tests__/two.tsx",
  "src/four.test.js",
  "src/three.spec.ts",
  "test/five.ts",
  "tests/six.py",
];

type Message = { level: string; code: string; text: string };
type Coverage =
  | { text: string; format: "lcov" }
  | {
      missingFile: string;
    };
type Diff = { text: string } | { unavailable: string };

const lines = (path: string) => fixture(path).trim().split("\n");
const withCode = (messages: readonly Message[], code: string) => messages.filter((message) => message.code === code);
const codes = (messages: readonly Message[]) => messages.map((message) => message.code);

const coverageOf = (mode: string): Coverage => {
  switch (mode) {
    case "normal":
      return { text: fixture("test-files-deleted/coverage.info"), format: "lcov" };
    case "missing":
      return { missingFile: "coverage/lcov.info" };
    case "empty":
      return { text: fixture("test-files-deleted/empty.info"), format: "lcov" };
    case "unmatched":
      return { text: fixture("test-files-deleted/coverage-unmatched.info"), format: "lcov" };
    default:
      throw new Error(`unknown coverage mode ${mode}`);
  }
};

async function runCheck(coverage: Coverage, diff: Diff) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage,
    diff,
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: lines("test-files-deleted/files.txt"),
  };
  const report = check(input as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

function expectSevenNamedAsFiveAndMore(messages: readonly Message[], label: string) {
  const found = withCode(messages, CODE);
  expect(found, label).toHaveLength(1);
  const text = found[0]?.text ?? "";
  const spans = [...text.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  expect(spans, label).toHaveLength(5);
  expect(new Set(spans).size, label).toBe(5);
  for (const span of spans) expect(SEVEN, `${label}: ${span}`).toContain(span);
  // `and 2 more` follows the last code span.
  const more = text.indexOf("and 2 more");
  expect(more, label).toBeGreaterThan(text.lastIndexOf("`"));
}

describe("check(): seven deleted test files on every report path", () => {
  it.each([
    ["normal", null],
    ["missing", "COVERAGE_FILE_MISSING"],
    ["empty", "COVERAGE_FILE_EMPTY"],
    ["unmatched", "COVERAGE_PATHS_UNMATCHED"],
  ] as const)(
    "AC-2: with %s coverage the report names five of the seven test files and `and 2 more`",
    async (mode, pathCode) => {
      const report = await runCheck(coverageOf(mode), { text: fixture("test-files-deleted/seven-deleted.diff") });
      // The inputs reach the report path they are meant to exercise.
      if (pathCode === null) expect(report.diffCoverage, mode).not.toBeNull();
      else expect(codes(report.messages), mode).toContain(pathCode);
      expectSevenNamedAsFiveAndMore(report.messages, mode);
    },
  );

  it("AC-2: with the diff unavailable the report carries no TEST_FILES_DELETED", async () => {
    const coverage = coverageOf("normal");
    // Control: the same coverage with the seven-deletion diff does carry the message.
    const control = await runCheck(coverage, { text: fixture("test-files-deleted/seven-deleted.diff") });
    expect(withCode(control.messages, CODE)).toHaveLength(1);

    const report = await runCheck(coverage, { unavailable: "no base" });
    expect(codes(report.messages)).toContain("DIFF_UNAVAILABLE");
    expect(withCode(report.messages, CODE)).toEqual([]);
  });
});
