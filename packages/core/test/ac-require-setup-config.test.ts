import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// The config parser and the fixtures are loaded inside the test body, like the other AC tests:
// fixtures/require-agent-setup/ does not exist before the build.

describe("parseConfig: setup.require", () => {
  it("AC-2: reads setup.require true and false as booleans, and rejects a non-boolean naming setup.require", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");

    for (const [name, expected] of [
      ["require-agent-setup/ci-require-true.yml", true],
      ["require-agent-setup/ci-require-false.yml", false],
    ] as const) {
      const config = parseConfig(fixture(name)) as { setup?: { require?: unknown } };
      expect(config.setup?.require, name).toBe(expected);
    }

    // Strings (bare or quoted) and numbers are not the YAML booleans true or false.
    for (const value of ["yes", '"true"', "maybe", "1", "0"]) {
      const text = `setup:\n  require: ${value}\n`;
      let thrown: unknown;
      try {
        parseConfig(text);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, value).toBeInstanceOf(ConfigError);
      expect((thrown as Error).message, value).toContain("setup.require");
    }
  });
});
