import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before format selection,
// clover.xml, jacoco-native.xml and fixtures/golden-cobertura/ exist, so nothing that depends on them may run while
// the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Selection = "lcov" | "cobertura" | "auto";

async function runCheck(text: string, format: Selection, threshold: number | null, file = "coverage.xml") {
  const { check } = await import("../src/check.js");
  return check({
    version: "0.1.0",
    coverage: { text, format, file },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
  });
}

const codes = (report: { messages: { code: string }[] }) => report.messages.map((message) => message.code);

describe("check(): coverage format selection", () => {
  it("AC-7: reports Clover and JaCoCo native XML under auto as COVERAGE_FORMAT_UNSUPPORTED", async () => {
    for (const name of ["clover.xml", "jacoco-native.xml"]) {
      const text = fixture(`cobertura/${name}`);
      for (const [threshold, level, verdict] of [
        [80, "error", "fail"],
        [null, "warn", "warn"],
      ] as const) {
        const label = `${name}, threshold ${threshold}`;
        const report = await runCheck(text, "auto", threshold);
        expectValidReport(report);
        expect(report.diffCoverage, label).toBeNull();
        expect(report.verdict, label).toBe(verdict);
        const coverageMessages = report.messages
          .filter((message) => message.code !== "NO_AGENT_SETUP_FILES")
          .map(({ level, code }) => ({ level, code }));
        expect(coverageMessages, label).toEqual([{ level, code: "COVERAGE_FORMAT_UNSUPPORTED" }]);
      }
    }
  });

  it("AC-8: reports empty text, a BOM with whitespace and <coverage/> under auto as COVERAGE_FILE_EMPTY", async () => {
    const cases: Record<string, string> = {
      "empty text": "",
      "BOM and whitespace": "﻿ \r\n\t \n",
      "<coverage/>": "<coverage/>",
    };
    for (const [label, text] of Object.entries(cases)) {
      const report = await runCheck(text, "auto", 80);
      expectValidReport(report);
      expect(report.diffCoverage, label).toBeNull();
      expect(codes(report), label).toContain("COVERAGE_FILE_EMPTY");
      expect(codes(report), label).not.toContain("COVERAGE_FORMAT_UNSUPPORTED");
    }
  });

  it("AC-9: gives the same report for the golden lcov inputs under auto and lcov, with diffCoverage.format lcov", async () => {
    const text = fixture("golden/coverage.info");
    const auto = await runCheck(text, "auto", 80, "coverage/lcov.info");
    const lcov = await runCheck(text, "lcov", 80, "coverage/lcov.info");
    expectValidReport(auto);
    expectValidReport(lcov);
    expect(auto).toEqual(lcov);
    expect(auto.diffCoverage?.format).toBe("lcov");
    expect(lcov.diffCoverage?.format).toBe("lcov");
  });

  it("AC-10: gives the same report for a Cobertura fixture under auto and cobertura, with diffCoverage.format cobertura", async () => {
    const text = fixture("golden-cobertura/coverage.xml");
    const auto = await runCheck(text, "auto", 80);
    const cobertura = await runCheck(text, "cobertura", 80);
    expectValidReport(auto);
    expectValidReport(cobertura);
    expect(auto).toEqual(cobertura);
    expect(auto.diffCoverage?.format).toBe("cobertura");
    expect(cobertura.diffCoverage?.format).toBe("cobertura");
  });

  it("AC-11: an explicit format skips detection, so it never yields COVERAGE_FORMAT_UNSUPPORTED", async () => {
    const clover = await runCheck(fixture("cobertura/clover.xml"), "cobertura", 80);
    expectValidReport(clover);
    expect(codes(clover)).not.toContain("COVERAGE_FORMAT_UNSUPPORTED");
    expect(codes(clover)).toContain("COVERAGE_FILE_EMPTY");

    const coberturaAsLcov = await runCheck(fixture("cobertura/coveragepy.xml"), "lcov", 80);
    expectValidReport(coberturaAsLcov);
    expect(codes(coberturaAsLcov)).not.toContain("COVERAGE_FORMAT_UNSUPPORTED");
  });
});
