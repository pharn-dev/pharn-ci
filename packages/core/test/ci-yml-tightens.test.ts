import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { type InputErrorText, type RawInputs, resolveInputs } from "../src/inputs.js";
import { applyPolicy } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The product rule "workflow inputs beat .pharn/ci.yml, and ci.yml may only tighten", for coverage.threshold and
// setup.require: the PR-carried config can raise the input's threshold and turn the setup requirement on, never lower
// the one or turn off the other. inputs/ci.yml sets threshold 80 and setup.require true; ci-require-false.yml sets
// setup.require false and no threshold.

const TEXT: InputErrorText = {
  coverageFormat: (value) => `bad format "${value}"`,
  threshold: "THRESHOLD",
  exclude: "EXCLUDE",
  coverageRoot: "ROOT",
  noCoverageFile: "no coverage file",
};

const STRICT = parseConfig(fixture("inputs/ci.yml"));
const REQUIRE_FALSE = parseConfig(fixture("require-agent-setup/ci-require-false.yml"));

function resolved(config: typeof STRICT, raw: RawInputs) {
  const result = resolveInputs(config, { coverageFile: "coverage/lcov.info", ...raw }, TEXT);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("; "));
  return result.inputs;
}

describe("resolveInputs: .pharn/ci.yml may only tighten the threshold and setup.require", () => {
  it("takes the larger threshold when both are given, the given one when only one is, and none when neither is", () => {
    const cases: Array<[string, typeof STRICT, string | undefined, number | null]> = [
      ["input 50 under config 80: the config's", STRICT, "50", 80],
      ["input 90 over config 80: the input's", STRICT, "90", 90],
      ["input 80 equal to config 80", STRICT, "80", 80],
      ["only the input", {}, "65.5", 65.5],
      ["only the config", STRICT, undefined, 80],
      ["neither", {}, undefined, null],
    ];
    for (const [name, config, threshold, expected] of cases) {
      expect(resolved(config, threshold === undefined ? {} : { threshold }).threshold, name).toBe(expected);
    }
  });

  it("turns the setup requirement on when the input or the config says true; an input false no longer turns off a config true", () => {
    const cases: Array<[string, typeof STRICT, boolean | undefined, boolean]> = [
      ["input false, config true", STRICT, false, true],
      ["input true, config false", REQUIRE_FALSE, true, true],
      ["input false, config false", REQUIRE_FALSE, false, false],
      ["input absent, config true", STRICT, undefined, true],
      ["input absent, config false", REQUIRE_FALSE, undefined, false],
      ["input true, no config", {}, true, true],
      ["input false, no config", {}, false, false],
      ["neither", {}, undefined, false],
    ];
    for (const [name, config, requireAgentSetup, expected] of cases) {
      const raw = requireAgentSetup === undefined ? {} : { requireAgentSetup };
      expect(resolved(config, raw).requireAgentSetup, name).toBe(expected);
    }
  });

  it("still lets the input replace the config's coverage file and format", () => {
    const inputs = resolved(STRICT, { coverageFile: "lcov.info", coverageFormat: "lcov", threshold: "50" });
    expect(inputs.coverageFile).toEqual({ path: "lcov.info", fromConfig: false });
    expect(inputs.coverageFormat).toBe("lcov");
    expect(inputs.threshold).toBe(80);
  });
});

describe("applyPolicy: the layer an app policy beat is the one whose value was in force", () => {
  const app = (document: Record<string, unknown>): ResolvedPolicy =>
    ({
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: { version: 1, ...document },
    }) as ResolvedPolicy;

  const layers = (config: typeof STRICT, raw: RawInputs) => {
    const fullRaw = { coverageFile: "coverage/lcov.info", ...raw };
    return { config, raw: fullRaw, resolved: resolved(config, fullRaw) };
  };

  /** check() on the golden inputs with the application's settings, its policy and ignored list; schema-validated. */
  const overrideTexts = (application: ReturnType<typeof applyPolicy>, policy: ResolvedPolicy) => {
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: application.inputs.threshold,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
      exclude: application.inputs.exclude,
      requireAgentSetup: application.inputs.requireAgentSetup,
      policy,
      policyIgnored: application.ignored,
    } as never);
    expectValidReport(report);
    return report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED").map((m) => m.text);
  };

  it("names the config when its threshold was larger than the input's, and the input when the input's was (or tied)", () => {
    const policy = app({ coverage: { threshold: 90 } });
    const cases: Array<[string, RawInputs, "input" | "config", number]> = [
      ["input 50 under config 80", { threshold: "50" }, "config", 80],
      ["input 85 over config 80", { threshold: "85" }, "input", 85],
      ["input 80 tied with config 80", { threshold: "80" }, "input", 80],
      ["no input, config 80", {}, "config", 80],
    ];
    for (const [name, raw, layer, given] of cases) {
      const application = applyPolicy(layers(STRICT, raw), policy);
      expect(application.inputs.threshold, name).toBe(90);
      expect(application.ignored, name).toEqual([
        { setting: "coverage.threshold", layer, reason: "looser", given, applied: 90 },
      ]);
      const texts = overrideTexts(application, policy);
      expect(texts, name).toHaveLength(1);
      expect(texts[0], name).toContain(`coverage.threshold (${layer}) ${given} → 90`);
    }
  });

  it("records no beaten setup.require when the config's true was in force over an input false; names the false layer otherwise", () => {
    const policy = app({ setup: { require: true } });
    const cases: Array<[string, typeof STRICT, RawInputs, Array<"input" | "config">]> = [
      ["input false, config true: already on", STRICT, { requireAgentSetup: false }, []],
      ["input false, config false", REQUIRE_FALSE, { requireAgentSetup: false }, ["input"]],
      ["input absent, config false", REQUIRE_FALSE, {}, ["config"]],
      ["input true, config false: already on", REQUIRE_FALSE, { requireAgentSetup: true }, []],
    ];
    for (const [name, config, raw, beaten] of cases) {
      const application = applyPolicy(layers(config, raw), policy);
      expect(application.inputs.requireAgentSetup, name).toBe(true);
      expect(application.ignored, name).toEqual(
        beaten.map((layer) => ({ setting: "setup.require", layer, reason: "looser" })),
      );
      expect(overrideTexts(application, policy), name).toHaveLength(beaten.length);
    }
  });
});
