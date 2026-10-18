import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the discovery module are imported inside the test body: they are written before the build.

const CANDIDATES = [
  "coverage/lcov.info",
  "lcov.info",
  "coverage.xml",
  "coverage/cobertura-coverage.xml",
  "**/coverage.cobertura.xml",
];

async function notDiscoveredReport(threshold: number | null) {
  const { check } = await import("../src/check.js");
  const { chooseDiscoveredCoverage } = await import("../src/coverageDiscovery.js");
  const notFound = chooseDiscoveredCoverage([]);
  return check({
    version: "0.1.0",
    coverage: notFound as Parameters<typeof check>[0]["coverage"],
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
  });
}

describe("check(): no coverage report discovered", () => {
  it("AC-5: one COVERAGE_FILE_MISSING naming the candidates, warn without a threshold and fail with 80", async () => {
    for (const [threshold, level, verdict] of [
      [null, "warn", "warn"],
      [80, "error", "fail"],
    ] as const) {
      const label = `threshold ${threshold}`;
      const report = await notDiscoveredReport(threshold);
      expectValidReport(report);
      expect(report.diffCoverage, label).toBeNull();
      const missing = report.messages.filter((message) => message.code === "COVERAGE_FILE_MISSING");
      expect(missing, label).toHaveLength(1);
      const [message] = missing;
      expect(message?.level, label).toBe(level);
      expect(report.verdict, label).toBe(verdict);
      for (const candidate of CANDIDATES) expect(message?.text, `${label}: ${candidate}`).toContain(candidate);
      expect(message?.text, label).toContain("coverage.file");
    }
  });
});
