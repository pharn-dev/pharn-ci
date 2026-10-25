import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI10 exists, so nothing the build adds
// may run while the file loads.

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

/** A file the diff deletes (status deleted). */
function deleteFile(path: string, lines: string[]): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    "index 1111111..0000000",
    `--- a/${path}`,
    "+++ /dev/null",
  ];
  return `${[...head, `@@ -1,${lines.length} +0,0 @@`, ...lines.map((l) => `-${l}`)].join("\n")}\n`;
}

async function run(diff: string, repoFiles: string[]) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const of = (report: Awaited<ReturnType<typeof run>>, id: string) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === id).map((s) => `${s.path}:${s.line ?? ""}`);

const PASS_WITH_NO_TESTS = edit("package.json", [
  7,
  7,
  ['    "test": "vitest run",'],
  ['    "test": "vitest run --passWithNoTests",'],
]);

const DELETED_TESTS = deleteFile("test/a.test.ts", [
  'import { expect, it } from "vitest";',
  'import { add } from "../src/a.js";',
  "",
  'it("adds", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});",
  "",
  'it("adds zero", () => {',
  "  expect(add(1, 0)).toBe(1);",
  "});",
]);

const WITH_TESTS = ["package.json", "src/a.ts", "src/a.test.ts"];
const WITHOUT_TESTS = ["package.json", "src/a.ts", "README.md"];

describe("TI10: --passWithNoTests in a repository with no test files", () => {
  it("AC-4: it fires with test files, not without them, again when the diff deletes a test file, and when the tracked-file list is empty", async () => {
    const withTests = await run(PASS_WITH_NO_TESTS, WITH_TESTS);
    expect(of(withTests, "TI10")).toEqual(["package.json:7"]);

    const withoutTests = await run(PASS_WITH_NO_TESTS, WITHOUT_TESTS);
    expect(of(withoutTests, "TI10")).toEqual([]);

    const deletedTests = await run(PASS_WITH_NO_TESTS + DELETED_TESTS, WITHOUT_TESTS);
    expect(of(deletedTests, "TI10")).toEqual(["package.json:7"]);
    expect(of(deletedTests, "TI01").map((at) => at.replace(/:.*$/, ""))).toEqual(["test/a.test.ts"]);

    const unknown = await run(PASS_WITH_NO_TESTS, []);
    expect(of(unknown, "TI10")).toEqual(["package.json:7"]);
  });
});
