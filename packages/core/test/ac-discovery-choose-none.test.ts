import { describe, expect, it } from "vitest";

// The discovery module is imported inside each test body: it does not exist before the build.

describe("chooseDiscoveredCoverage: no candidate", () => {
  it("AC-4: an empty set and a set of only unrelated paths are not-found", async () => {
    const { chooseDiscoveredCoverage } = await import("../src/coverageDiscovery.js");
    expect(chooseDiscoveredCoverage([])).toEqual({ kind: "not-found" });
    expect(chooseDiscoveredCoverage(["src/a.ts", "docs/coverage.md", "coverage/index.html"])).toEqual({
      kind: "not-found",
    });
  });

  it("AC-4: the exported candidate list is exactly the five candidates, in order", async () => {
    const { COVERAGE_DISCOVERY_CANDIDATES } = await import("../src/coverageDiscovery.js");
    expect([...COVERAGE_DISCOVERY_CANDIDATES]).toEqual([
      "coverage/lcov.info",
      "lcov.info",
      "coverage.xml",
      "coverage/cobertura-coverage.xml",
      "**/coverage.cobertura.xml",
    ]);
  });
});
