import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body, like the other AC tests: they are written before the build.

async function unavailableDiffReport(threshold: number | null) {
  const { check } = await import("../src/check.js");
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" },
    diff: { unavailable: "could not get the diff for base...head" },
    repoRoot: "/home/runner/work/demo/demo",
    threshold,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
  });
}

describe("check(): an unavailable diff with the golden lcov", () => {
  it("AC-2: fails with a threshold and warns without one, carrying DIFF_UNAVAILABLE", async () => {
    for (const [threshold, verdict] of [
      [80, "fail"],
      [null, "warn"],
    ] as const) {
      const label = `threshold ${threshold}`;
      const report = await unavailableDiffReport(threshold);
      expectValidReport(report);
      expect(report.diffCoverage, label).toBeNull();
      expect(
        report.messages.map((message) => message.code),
        label,
      ).toContain("DIFF_UNAVAILABLE");
      expect(report.verdict, label).toBe(verdict);
    }
  });
});
