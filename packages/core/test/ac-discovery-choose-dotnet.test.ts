import { describe, expect, it } from "vitest";

// The discovery module is imported inside the test body: it does not exist before the build.

describe("chooseDiscoveredCoverage: several .NET coverlet files", () => {
  it("AC-2: every coverage.cobertura.xml match is one candidate, found with all its files sorted", async () => {
    const { chooseDiscoveredCoverage } = await import("../src/coverageDiscovery.js");
    const paths = [
      "tests/App.Tests/TestResults/c3/coverage.cobertura.xml",
      "src/a.ts",
      "tests/App.Tests/TestResults/a1/coverage.cobertura.xml",
      "tests/App.Tests/TestResults/b2/coverage.cobertura.xml",
    ];
    const result = chooseDiscoveredCoverage(paths);
    expect(result).toEqual({
      kind: "found",
      files: [
        "tests/App.Tests/TestResults/a1/coverage.cobertura.xml",
        "tests/App.Tests/TestResults/b2/coverage.cobertura.xml",
        "tests/App.Tests/TestResults/c3/coverage.cobertura.xml",
      ],
    });
    expect(result).not.toHaveProperty("found");
  });
});
