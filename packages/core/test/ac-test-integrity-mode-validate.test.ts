import { describe, expect, it } from "vitest";

// resolveInputs and parseConfig are loaded inside each test body: these tests are written before the
// `test-integrity` setting exists, so nothing that depends on it may run while the file loads.

const TEXT = {
  coverageFormat: (value: string) => `bad coverage format ${value}`,
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage-root",
  noCoverageFile: "no coverage file",
};

const raw = (testIntegrity?: string) => ({
  coverageFile: "coverage/lcov.info",
  ...(testIntegrity === undefined ? {} : { testIntegrity }),
});

async function resolve(config: object, testIntegrity?: string) {
  const { resolveInputs } = await import("../src/inputs.js");
  return resolveInputs(config as never, raw(testIntegrity) as never, TEXT as never);
}

describe("test-integrity setting validation", () => {
  it("AC-6: an input other than block, warn or off is an error naming the allowed values", async () => {
    for (const value of ["Block", "true", "loud"]) {
      const result = await resolve({}, value);
      expect(result.ok, value).toBe(false);
      if (result.ok) continue;
      const error = result.errors.find((e) => (e.input as string) === "testIntegrity");
      expect(error, value).toBeDefined();
      for (const allowed of ["block", "warn", "off"]) expect(error?.message, value).toContain(allowed);
    }
  });

  it("AC-6: surrounding whitespace is trimmed and an empty or whitespace-only input counts as not given", async () => {
    const trimmed = await resolve({}, "off ");
    expect(trimmed.ok).toBe(true);
    if (trimmed.ok)
      expect((trimmed.inputs as never as Record<string, { input?: string }>).testIntegrityMode?.input).toBe("off");

    for (const value of ["  ", ""]) {
      const result = await resolve({}, value);
      expect(result.ok, JSON.stringify(value)).toBe(true);
      if (result.ok) {
        const mode = (result.inputs as never as Record<string, { input?: string }>).testIntegrityMode;
        expect(mode?.input, JSON.stringify(value)).toBeUndefined();
      }
    }
  });

  it("AC-6: test_integrity.mode in the config is read and handed to resolveInputs as the config value", async () => {
    const { parseConfig } = await import("../src/config.js");
    const config = parseConfig("test_integrity:\n  mode: block\n");
    expect((config as never as Record<string, unknown>).testIntegrity).toEqual({ mode: "block" });

    const result = await resolve(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.inputs as never as Record<string, unknown>).testIntegrityMode).toEqual({ config: "block" });
    }
  });

  it("AC-6: a bad test_integrity.mode or an unknown key under test_integrity is a ConfigError", async () => {
    const { parseConfig, ConfigError } = await import("../src/config.js");
    const message = (source: string): string => {
      try {
        parseConfig(source);
      } catch (err) {
        expect(err, source).toBeInstanceOf(ConfigError);
        return (err as Error).message;
      }
      throw new Error(`parseConfig accepted ${JSON.stringify(source)}`);
    };

    for (const source of [
      "test_integrity:\n  mode: loud\n",
      "test_integrity:\n  mode: true\n",
      "test_integrity:\n  mode: 1\n",
    ]) {
      const text = message(source);
      for (const allowed of ["block", "warn", "off"]) expect(text, source).toContain(allowed);
    }
    expect(message("test_integrity:\n  other: 1\n")).toContain("test_integrity.other");
  });
});
