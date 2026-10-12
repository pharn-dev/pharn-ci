import { describe, expect, it } from "vitest";

// The config parser is imported inside the test body, like the other AC tests.

describe("parseConfig: coverage.format", () => {
  it("AC-15: accepts lcov, cobertura and auto, and rejects clover naming the three accepted values", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");
    for (const format of ["lcov", "cobertura", "auto"]) {
      expect(parseConfig(`coverage:\n  format: ${format}\n`), format).toEqual({ coverage: { format } });
    }

    const clover = "coverage:\n  format: clover\n";
    expect(() => parseConfig(clover)).toThrow(ConfigError);
    let message = "";
    try {
      parseConfig(clover);
    } catch (error) {
      message = (error as Error).message;
    }
    for (const accepted of ["lcov", "cobertura", "auto"]) {
      expect(message, accepted).toContain(accepted);
    }
  });
});
