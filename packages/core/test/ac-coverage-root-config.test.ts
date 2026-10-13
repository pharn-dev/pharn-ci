import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// The config parser and the fixtures are loaded inside the test body, like the other AC tests:
// fixtures/coverage-paths/ does not exist before the build.

describe("parseConfig: coverage.root", () => {
  it("AC-7: reads coverage.root normalized, and rejects unsafe or non-string values naming coverage.root", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");

    for (const name of [
      "coverage-paths/package-relative/ci-root.yml",
      "coverage-paths/package-relative/ci-root-dotted.yml",
    ]) {
      const config = parseConfig(fixture(name)) as { coverage?: { root?: unknown } };
      expect(config.coverage?.root, name).toBe("packages/core");
    }

    // Absolute, climbing, option-like, backslashed, and not strings.
    for (const value of ["/app", "../x", "a/../../b", "-x", "packages\\core", "5", "true"]) {
      const text = `coverage:\n  root: ${value}\n`;
      let thrown: unknown;
      try {
        parseConfig(text);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, value).toBeInstanceOf(ConfigError);
      expect((thrown as Error).message, value).toContain("coverage.root");
    }
  });
});
