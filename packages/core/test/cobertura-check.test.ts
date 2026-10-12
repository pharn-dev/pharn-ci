import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside the test body: the AC test is written before the Cobertura parser
// exists, so nothing that depends on it may run while the file loads.

describe("check(): empty Cobertura reports", () => {
  it("AC-14: reports empty and line-less Cobertura files as COVERAGE_FILE_EMPTY with no diff coverage", async () => {
    const { check } = await import("../src/check.js");
    const repoFiles = fixture("golden/files.txt").trim().split("\n");
    for (const name of ["empty.xml", "no-lines.xml"]) {
      const report = check({
        version: "0.1.0",
        coverage: { text: fixture(`cobertura/${name}`), format: "cobertura", file: "coverage.xml" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: 80,
        repoFiles,
      });
      expectValidReport(report);
      expect(report.diffCoverage, name).toBeNull();
      expect(
        report.messages.filter((message) => message.code === "COVERAGE_FILE_EMPTY"),
        name,
      ).toHaveLength(1);
    }
  });
});
