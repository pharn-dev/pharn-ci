import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// The schema validator is loaded inside the test body, like the other AC tests. The base report is the golden
// report with any diffCoverage.format removed, so every variant below differs from it in one place only.

describe("schema/report.v1.json: diffCoverage.format and COVERAGE_FORMAT_UNSUPPORTED", () => {
  it("AC-12: accepts the lcov, cobertura and absent formats and the new code, and rejects clover", async () => {
    const { validateReport } = await import("./schema.js");
    const base = JSON.parse(fixture("golden/report.json"));
    delete base.diffCoverage.format;

    const withFormat = (format: string) => ({ ...base, diffCoverage: { ...base.diffCoverage, format } });
    const withUnsupported = {
      ...base,
      verdict: "fail",
      diffCoverage: null,
      messages: [
        {
          level: "error",
          code: "COVERAGE_FORMAT_UNSUPPORTED",
          text: "Coverage file coverage.xml is not in a recognized coverage format; pharn-ci reads lcov and Cobertura XML.",
        },
      ],
    };

    expect(validateReport(withFormat("lcov")), "format lcov").toBe(true);
    expect(validateReport(withFormat("cobertura")), "format cobertura").toBe(true);
    expect(validateReport(base), "no format").toBe(true);
    expect(validateReport(withUnsupported), "COVERAGE_FORMAT_UNSUPPORTED").toBe(true);
    expect(validateReport(withFormat("clover")), "format clover").toBe(false);
  });
});
