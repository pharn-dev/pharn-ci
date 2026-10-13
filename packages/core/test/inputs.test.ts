import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";
import { gitDiffArgs, InputError, type InputErrorText, resolveInputs } from "../src/inputs.js";
import { fixture } from "./helpers.js";

const TEXT: InputErrorText = {
  coverageFormat: (value) => `bad format "${value}"`,
  threshold: "THRESHOLD",
  exclude: "EXCLUDE",
  coverageRoot: "ROOT",
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

describe("resolveInputs: coverage root (F-01)", () => {
  const rootConfig = parseConfig(fixture("coverage-paths/package-relative/ci-root.yml"));
  const resolveRoot = (cfg: typeof rootConfig, coverageRoot?: string) => {
    const resolved = resolveInputs(cfg, { coverageFile: "lcov.info", coverageRoot }, TEXT);
    return resolved.ok ? resolved.inputs.coverageRoot : resolved.errors.map((e) => [e.input, e.message]);
  };

  it("takes the input over coverage.root, then coverage.root, then none, normalized", () => {
    expect(resolveRoot(rootConfig, "./packages/web/")).toBe("packages/web");
    expect(resolveRoot(rootConfig)).toBe("packages/core");
    expect(resolveRoot({})).toBeUndefined();
    expect(resolveRoot({}, ".")).toBe(".");
  });

  it("reports an unsafe input in the adapter's words, after the other settings", () => {
    expect(resolveRoot(rootConfig, "../x")).toEqual([["coverageRoot", 'ROOT "../x" must not contain a ".." segment']]);
    const resolved = resolveInputs({}, { threshold: "101", coverageRoot: "/abs" }, TEXT);
    expect(resolved.ok ? [] : resolved.errors.map((e) => e.input)).toEqual([
      "threshold",
      "coverageFile",
      "coverageRoot",
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
