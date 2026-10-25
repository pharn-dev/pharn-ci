import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-bold-look AC-7. check() and the renderer are loaded inside the test body: the AC tests are written before
// the build, so nothing the build changes may run while the file loads.

/** sha256 of fixtures/golden/report.json as committed before this increment: the report data must not change. */
const GOLDEN_JSON_SHA256 = "37d7101a203ba54c38b9636631edc8c7bc03e82ff6deaaa0de84a2f62f8635f7";

/**
 * The committed golden report.json in its Report v1 form, the bytes the hash above was taken from. Report v2 changed
 * it only by setting schemaVersion to 2 and appending the empty testIntegrity block, both asserted below.
 */
function asV1File(json: string): string {
  const parsed = JSON.parse(json);
  expect(parsed.schemaVersion).toBe(2);
  expect(parsed.testIntegrity).toEqual({
    mode: "warn",
    source: "default",
    verdict: "pass",
    signals: [],
    languages: [],
  });
  const { testIntegrity: _testIntegrity, ...v1 } = { ...parsed, schemaVersion: "1" };
  return `${JSON.stringify(v1, null, 2)}\n`;
}

/**
 * The message and hint lines of fixtures/golden/report.md as committed before this increment (its lines 19 to 22),
 * written here so a regenerated golden cannot move them. U+2139 U+FE0F is the info icon.
 */
const GOLDEN_MESSAGE_LINES = [
  "- ❌ `DIFF_COVERAGE_BELOW_THRESHOLD` Diff coverage 71.43% is below the threshold of 80%.",
  "  - Hint: Add tests that exercise the uncovered lines listed in the table above.",
  "- ℹ️ `COVERAGE_PATHS_PARTIALLY_UNMATCHED` 1 file path in the coverage report is not a tracked file in the repository; its coverage is not used.",
  "  - Hint: Nothing to do if those files are generated or outside the repo; if changed files are missing from the table, check the coverage root.",
];

/** The non-empty lines of the Messages section: from its heading to the next heading. */
function messageLines(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line.startsWith("### 💬 Messages ("));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("#"));
  return lines.slice(start + 1, end === -1 ? lines.length : end).filter((line) => line.trim() !== "");
}

describe("check() and renderMarkdown(): report data and message text unchanged", () => {
  it("AC-7: the golden report equals the committed report.json, and the Messages section carries the committed message and hint lines", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const committed = fixture("golden/report.json");
    expect(createHash("sha256").update(asV1File(committed)).digest("hex"), "report.json as committed before").toBe(
      GOLDEN_JSON_SHA256,
    );

    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(report);
    expect(report).toEqual(JSON.parse(committed));

    const lines = renderMarkdown(report).split("\n");
    expect(messageLines(lines)).toEqual(GOLDEN_MESSAGE_LINES);
  });
});
