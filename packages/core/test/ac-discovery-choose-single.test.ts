import { describe, expect, it } from "vitest";

// The discovery module is imported inside each test body: these tests are written before the build, so the
// module does not exist yet and a top-level import would stop the whole file from loading.

const SINGLE_CANDIDATES = [
  "coverage/lcov.info",
  "lcov.info",
  "coverage.xml",
  "coverage/cobertura-coverage.xml",
  "tests/App.Tests/TestResults/abc/coverage.cobertura.xml",
];

describe("chooseDiscoveredCoverage: exactly one candidate", () => {
  it("AC-1: one candidate of each kind among unrelated paths is found, and is the only file", async () => {
    const { chooseDiscoveredCoverage } = await import("../src/coverageDiscovery.js");
    for (const candidate of SINGLE_CANDIDATES) {
      const result = chooseDiscoveredCoverage(["src/a.ts", candidate, "README.md"]);
      expect(result, candidate).toEqual({ kind: "found", files: [candidate] });
    }
  });

  it("AC-1: the choice does not depend on where the candidate sits in the input", async () => {
    const { chooseDiscoveredCoverage } = await import("../src/coverageDiscovery.js");
    for (const candidate of SINGLE_CANDIDATES) {
      const result = chooseDiscoveredCoverage(new Set([candidate, "README.md", "src/a.ts"]));
      expect(result, candidate).toEqual({ kind: "found", files: [candidate] });
    }
  });
});
