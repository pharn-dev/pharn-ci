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

const VALID_LINES = ['<line number="3" hits="1"/>', '<line number="4" hits="0"/>', '<line number="5" hits="2"/>'];
const MALFORMED_LINES = ['<line number="0" hits="1"/>', '<line number="x" hits="1"/>', '<line number="4" hits="-2"/>'];

/** A Cobertura report with one class for src/math.ts whose class-level lines are `lines`. */
const cobertura = (lines: readonly string[]) =>
  [
    '<?xml version="1.0" ?>',
    '<coverage line-rate="0.66" branch-rate="0" version="1.9" timestamp="1">',
    "  <packages>",
    '    <package name="src">',
    "      <classes>",
    '        <class name="math" filename="src/math.ts">',
    "          <lines>",
    ...lines.map((line) => `            ${line}`),
    "          </lines>",
    "        </class>",
    "      </classes>",
    "    </package>",
    "  </packages>",
    "</coverage>",
    "",
  ].join("\n");

describe("check(): malformed Cobertura lines are counted", () => {
  it("AC-2: reports one info COVERAGE_LINES_SKIPPED message with the count 3 and leaves the verdict unchanged", async () => {
    const { check } = await import("../src/check.js");
    const run = (text: string) =>
      check({
        version: "0.1.0",
        coverage: { text, format: "auto" },
        diff: { text: DIFF },
        repoFiles: ["src/math.ts"],
        threshold: 50,
      });

    const report = run(cobertura([...VALID_LINES, ...MALFORMED_LINES]));
    const clean = run(cobertura(VALID_LINES));
    expectValidReport(report);
    expectValidReport(clean);

    // Diff coverage was computed on both, and the malformed lines did not change the verdict.
    expect(report.diffCoverage).not.toBeNull();
    expect(clean.diffCoverage).not.toBeNull();
    expect(report.verdict).toBe(clean.verdict);

    const skipped = (report.messages as readonly Message[]).filter((message) => message.code === CODE);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.level).toBe("info");
    expect(skipped[0]?.text).toContain("3");
  });
});
