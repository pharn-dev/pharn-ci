import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";
import { gitDiffArgs, InputError, type InputErrorText, resolveInputs } from "../src/inputs.js";
import { fixture } from "./helpers.js";

const TEXT: InputErrorText = {
  coverageFormat: (value) => `bad format "${value}"`,
  threshold: "THRESHOLD",
  exclude: "EXCLUDE",
  noCoverageFile: "no coverage file",
};

const config = parseConfig(fixture("inputs/ci.yml"));

describe("resolveInputs", () => {
  it("takes every setting from the config when no input is given", () => {
    expect(resolveInputs(config, {}, TEXT)).toEqual({
      ok: true,
      inputs: {
        coverageFile: { path: "cov/lcov.info", fromConfig: true },
        coverageFormat: "cobertura",
        threshold: 80,
        exclude: ["src/generated/**"],
        requireAgentSetup: true,
      },
    });
  });

  it("lets inputs override the config, and adds input exclusions after the config's", () => {
    const resolved = resolveInputs(
      config,
      {
        coverageFile: "lcov.info",
        coverageFormat: "lcov",
        threshold: "90.5",
        exclude: ["./vendor/**", " *.gen.ts "],
        requireAgentSetup: false,
      },
      TEXT,
    );
    expect(resolved).toEqual({
      ok: true,
      inputs: {
        coverageFile: { path: "lcov.info", fromConfig: false },
        coverageFormat: "lcov",
        threshold: 90.5,
        exclude: ["src/generated/**", "vendor/**", "*.gen.ts"],
        requireAgentSetup: false,
      },
    });
  });

  it("falls back to auto, no threshold, no exclusions and no setup requirement", () => {
    expect(resolveInputs({}, { coverageFile: "" }, TEXT)).toEqual({
      ok: true,
      inputs: {
        coverageFile: { path: "", fromConfig: false },
        coverageFormat: "auto",
        threshold: null,
        exclude: [],
        requireAgentSetup: false,
      },
    });
  });

  it("reports every invalid setting in a fixed order, in the adapter's words", () => {
    const resolved = resolveInputs(
      {},
      { coverageFormat: "xml", threshold: "101", exclude: ["ok/**", "/abs", "!neg"] },
      TEXT,
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.errors.map((e) => [e.input, e.message])).toEqual([
      ["coverageFormat", 'bad format "xml"'],
      ["threshold", "THRESHOLD must be a number between 0 and 100"],
      ["coverageFile", "no coverage file"],
      // Only the first invalid pattern, as parseExcludePattern reports it.
      ["exclude", 'EXCLUDE "/abs" must not start with "/" (patterns are relative to the repository root)'],
    ]);
    for (const error of resolved.errors) {
      expect(error).toBeInstanceOf(InputError);
      expect(error).toBeInstanceOf(ConfigError);
    }
  });

  it("treats a given empty input as given: an empty format or threshold is invalid", () => {
    const resolved = resolveInputs(config, { coverageFormat: "", threshold: "" }, TEXT);
    expect(resolved.ok ? [] : resolved.errors.map((e) => e.message)).toEqual([
      'bad format ""',
      "THRESHOLD must be a number between 0 and 100",
    ]);
  });
});

describe("gitDiffArgs", () => {
  it("diffs base...HEAD with fixed prefixes and the range after --end-of-options", () => {
    expect(gitDiffArgs("origin/main")).toEqual([
      "diff",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--end-of-options",
      "origin/main...HEAD",
    ]);
    expect(gitDiffArgs("-x", "topic").slice(-2)).toEqual(["--end-of-options", "-x...topic"]);
  });
});
