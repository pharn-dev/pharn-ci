import { describe, expect, it } from "vitest";
import type { InputErrorText } from "../src/inputs.js";
import { fixture } from "./helpers.js";

// The targets are imported inside each test body: these AC tests are written before the strict threshold rule
// exists, so nothing that depends on it may run while the file loads. (The type import above is erased.)

const ERROR = "must be a number between 0 and 100";

const TEXT: InputErrorText = {
  coverageFormat: (value) => `bad format "${value}"`,
  threshold: "THRESHOLD",
  exclude: "EXCLUDE",
  coverageRoot: "ROOT",
  noCoverageFile: "no coverage file",
};

describe("strict threshold validator", () => {
  it("AC-1: accepts plain decimals 0-100 and finite numbers, and refuses every other text form", async () => {
    const { ConfigError, parseThreshold } = await import("../src/config.js");

    const accepted: [unknown, number][] = [
      ["80", 80],
      ["80.5", 80.5],
      ["0", 0],
      ["100", 100],
      [" 80 ", 80],
      [0, 0],
      [72.5, 72.5],
      [100, 100],
    ];
    for (const [value, expected] of accepted) {
      expect(parseThreshold(value), JSON.stringify(value)).toBe(expected);
    }

    const refused = ["1e2", "5e1", "0x10", "+5", "-1", ".", ".5", "80.", "Infinity", "80%", "8 0", "", "100.1"];
    for (const value of refused) {
      let thrown: unknown;
      try {
        parseThreshold(value);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(value)).toBeInstanceOf(ConfigError);
      expect((thrown as Error).message, JSON.stringify(value)).toContain(ERROR);
    }
  });

  it("AC-1: the input resolver refuses the threshold 1e2 and 0x10 with one error in the adapter's words", async () => {
    const { parseConfig } = await import("../src/config.js");
    const { resolveInputs } = await import("../src/inputs.js");
    const config = parseConfig(fixture("inputs/ci.yml"));

    for (const threshold of ["1e2", "0x10"]) {
      const resolved = resolveInputs(config, { threshold }, TEXT);
      expect(resolved.ok, threshold).toBe(false);
      if (resolved.ok) continue;
      expect(
        resolved.errors.map((e) => [e.input, e.message]),
        threshold,
      ).toEqual([["threshold", "THRESHOLD must be a number between 0 and 100"]]);
    }
  });
});
