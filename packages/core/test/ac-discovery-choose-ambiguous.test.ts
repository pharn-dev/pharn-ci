import { describe, expect, it } from "vitest";

// The discovery module is imported inside the test body: it does not exist before the build.

const CASES: { name: string; candidates: string[] }[] = [
  { name: "coverage/lcov.info with lcov.info", candidates: ["coverage/lcov.info", "lcov.info"] },
  {
    name: "coverage.xml with one coverlet file",
    candidates: ["coverage.xml", "tests/App.Tests/TestResults/abc/coverage.cobertura.xml"],
  },
  {
    name: "all five kinds at once",
    candidates: [
      "coverage/lcov.info",
      "lcov.info",
      "coverage.xml",
      "coverage/cobertura-coverage.xml",
      "tests/App.Tests/TestResults/abc/coverage.cobertura.xml",
    ],
  },
];

describe("chooseDiscoveredCoverage: different candidates found", () => {
  it("AC-3: two or more different candidates are ambiguous, list every found path and choose no file", async () => {
    const { chooseDiscoveredCoverage } = await import("../src/coverageDiscovery.js");
    for (const { name, candidates } of CASES) {
      const result = chooseDiscoveredCoverage([...candidates, "src/a.ts"]);
      expect(result.kind, name).toBe("ambiguous");
      expect(result, name).not.toHaveProperty("files");
      const found = (result as { found?: unknown }).found;
      expect(Array.isArray(found), name).toBe(true);
      expect([...(found as string[])].sort(), name).toEqual([...candidates].sort());
    }
  });
});
