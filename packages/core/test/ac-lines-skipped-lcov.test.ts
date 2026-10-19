import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// check() is imported inside the test body: this AC test is written before the skipped-records message exists,
// so nothing that depends on it may run while the file loads.

const CODE = "COVERAGE_LINES_SKIPPED";

type Message = { level: string; code: string; text: string };

// A diff that adds lines 3 to 5 of src/math.ts.
const DIFF = [
  "diff --git a/src/math.ts b/src/math.ts",
  "index 1111111..2222222 100644",
  "--- a/src/math.ts",
  "+++ b/src/math.ts",
  "@@ -2,0 +3,3 @@ export function add(a: number, b: number) {",
  "+  if (a < 0) {",
  "+    return -add(-a, -b);",
  "+  }",
  "",
].join("\n");

// Valid records for src/math.ts, with no malformed record.
const CLEAN = ["TN:", "SF:src/math.ts", "DA:3,1", "DA:4,0", "DA:5,2", "end_of_record", ""].join("\n");

// The same valid records plus five malformed DA records: one orphan before any SF, and four inside the SF
// (a non-integer line number, a negative hit count, and the same zero line number twice).
const MALFORMED = [
  "TN:",
  "DA:7,1",
  "SF:src/math.ts",
  "DA:abc,1",
  "DA:3,1",
  "DA:3,-1",
  "DA:4,0",
  "DA:0,1",
  "DA:5,2",
  "DA:0,1",
  "end_of_record",
  "",
].join("\n");

describe("check(): malformed lcov records are counted", () => {
  it("AC-1: reports one info COVERAGE_LINES_SKIPPED message with the count 5 and leaves verdict and percent unchanged", async () => {
    const { check } = await import("../src/check.js");
    const run = (text: string) =>
      check({
        version: "0.1.0",
        coverage: { text, format: "auto" },
        diff: { text: DIFF },
        repoFiles: ["src/math.ts"],
        threshold: 50,
      });

    const report = run(MALFORMED);
    const clean = run(CLEAN);
    expectValidReport(report);
    expectValidReport(clean);

    // Diff coverage was computed on both, and the malformed records changed neither the verdict nor the percent.
    expect(report.diffCoverage).not.toBeNull();
    expect(clean.diffCoverage).not.toBeNull();
    expect(report.verdict).toBe(clean.verdict);
    expect(report.diffCoverage?.percent).toBe(clean.diffCoverage?.percent);

    const cleanSkipped = (clean.messages as readonly Message[]).filter((message) => message.code === CODE);
    expect(cleanSkipped).toEqual([]);

    const skipped = (report.messages as readonly Message[]).filter((message) => message.code === CODE);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.level).toBe("info");
    expect(skipped[0]?.text).toContain("5");
  });
});
