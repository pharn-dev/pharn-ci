import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";
import { resolveDependencySettings } from "../src/dependencies/settings.js";
import { type InputErrorText, resolveInputs } from "../src/inputs.js";
import { applyPolicy } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import { validatePolicy } from "../src/policy/validate.js";

// A13 (dependency safety): who decides the mode and the minimums. The input is the trusted base; .pharn/ci.yml and a
// policy file are carried by the pull request and may only tighten; an app policy is authoritative. Lookups send package
// names to a third party, so they are opt-in and `never` stays the workflow's choice against anything the PR carries.

const TEXT: InputErrorText = {
  coverageFormat: (v) => `bad format ${v}`,
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage-root",
  dependencies: "dependencies",
  noCoverageFile: "no coverage file",
};

const appPolicy = (dependencies: object): ResolvedPolicy => ({
  source: "app",
  version: 3,
  document: { version: 1, dependencies },
});
const filePolicy = (dependencies: object): ResolvedPolicy => ({
  source: "file",
  version: null,
  path: ".github/pharn-policy.json",
  document: { version: 1, dependencies },
});

describe("resolveDependencySettings", () => {
  it("defaults to auto, 30 days, 100 downloads and both registries", () => {
    expect(resolveDependencySettings()).toEqual({
      mode: "auto",
      minAgeDays: 30,
      minWeeklyDownloads: 100,
      registries: ["npm", "pypi"],
    });
  });

  it("lets the config turn lookups on over auto but never over never, and only raise the minimums", () => {
    expect(resolveDependencySettings({ config: { lookup: true } }).mode).toBe("lookup");
    expect(resolveDependencySettings({ input: "never", config: { lookup: true } }).mode).toBe("never");
    expect(resolveDependencySettings({ input: "lookup", config: { lookup: false } }).mode).toBe("lookup");
    const lowered = resolveDependencySettings({ config: { minAgeDays: 7, minWeeklyDownloads: 1 } });
    expect([lowered.minAgeDays, lowered.minWeeklyDownloads]).toEqual([30, 100]);
    const raised = resolveDependencySettings({ config: { minAgeDays: 90, minWeeklyDownloads: 1000 } });
    expect([raised.minAgeDays, raised.minWeeklyDownloads]).toEqual([90, 1000]);
  });

  it("lets an app policy require the check and lookups, set its own minimums and narrow the registries", () => {
    expect(resolveDependencySettings({ input: "never", policy: { kind: "app" } }).mode).toBe("auto");
    expect(resolveDependencySettings({ input: "never", policy: { kind: "app", lookup: true } }).mode).toBe("lookup");
    expect(resolveDependencySettings({ input: "lookup", policy: { kind: "app", lookup: false } }).mode).toBe("lookup");
    const app = resolveDependencySettings({
      config: { minAgeDays: 10 },
      policy: { kind: "app", minAgeDays: 7, minWeeklyDownloads: 50, registries: ["pypi"] },
    });
    expect(app).toEqual({ mode: "auto", minAgeDays: 10, minWeeklyDownloads: 50, registries: ["pypi"] });
  });

  it("treats a policy file like the config: it may raise, never require over never, never narrow", () => {
    expect(resolveDependencySettings({ input: "never", policy: { kind: "file", lookup: true } }).mode).toBe("never");
    expect(resolveDependencySettings({ policy: { kind: "file", lookup: true } }).mode).toBe("lookup");
    const file = resolveDependencySettings({ policy: { kind: "file", minAgeDays: 1, registries: ["npm"] } });
    expect([file.minAgeDays, file.registries]).toEqual([30, ["npm", "pypi"]]);
  });
});

describe("the config and the inputs", () => {
  it("reads dependencies.lookup and the two minimums from .pharn/ci.yml", () => {
    expect(parseConfig("dependencies:\n  lookup: true\n  min_age_days: 60\n  min_weekly_downloads: 500\n")).toEqual({
      dependencies: { lookup: true, minAgeDays: 60, minWeeklyDownloads: 500 },
    });
    for (const [text, message] of [
      ["dependencies:\n  lookup: yes\n", '"dependencies.lookup" must be true or false'],
      ["dependencies:\n  min_age_days: 1e2\n", '"dependencies.min_age_days" must be a whole number between 0 and 3650'],
      [
        "dependencies:\n  min_age_days: 3651\n",
        '"dependencies.min_age_days" must be a whole number between 0 and 3650',
      ],
      ["dependencies:\n  min_weekly_downloads: -1\n", '"dependencies.min_weekly_downloads" must be a whole number'],
      ["dependencies:\n  registries: [npm]\n", "lists are not supported"],
      ["dependencies:\n  hosts: x\n", 'unknown key "dependencies.hosts"'],
      ["dependencies: 3\n", '"dependencies" must be a mapping'],
    ] as const) {
      expect(() => parseConfig(text), text).toThrow(ConfigError);
      expect(() => parseConfig(text), text).toThrow(message);
    }
  });

  it("validates the dependencies input and keeps the layers only when one is given", () => {
    const raw = { coverageFile: "coverage/lcov.info" };
    const none = resolveInputs({}, raw, TEXT);
    expect(none.ok && "dependencies" in none.inputs).toBe(false);
    const given = resolveInputs({ dependencies: { lookup: true } }, { ...raw, dependencies: " never " }, TEXT);
    expect(given.ok && given.inputs.dependencies).toEqual({ input: "never", config: { lookup: true } });
    const bad = resolveInputs({}, { ...raw, dependencies: "always" }, TEXT);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors[0].message).toBe('dependencies must be one of: auto, lookup, never (got "always")');
    expect(!bad.ok && bad.errors[0].input).toBe("dependencies");
  });
});

describe("the org policy", () => {
  it("validates dependencies.lookup", () => {
    expect(validatePolicy({ version: 1, dependencies: { lookup: true, min_age_days: 14 } }).ok).toBe(true);
    expect(validatePolicy({ version: 1, dependencies: { lookup: "yes" } }).ok).toBe(false);
  });

  it("carries the app policy's dependencies into the settings and records a beaten never input", () => {
    const layers = {
      config: {},
      raw: { coverageFile: "c", dependencies: "never" },
      resolved: {
        coverageFile: { path: "c", fromConfig: false },
        coverageFormat: "auto" as const,
        threshold: null,
        exclude: [],
        coverageRoot: undefined,
        requireAgentSetup: false,
        dependencies: { input: "never" as const },
      },
    };
    const app = applyPolicy(layers, appPolicy({ lookup: true, registries: ["npm"], min_age_days: 14 }));
    expect(app.inputs.dependencies).toEqual({
      input: "never",
      policy: { kind: "app", lookup: true, minAgeDays: 14, registries: ["npm"] },
    });
    expect(app.ignored).toEqual([{ setting: "dependencies", layer: "input", reason: "looser" }]);
    expect(resolveDependencySettings(app.inputs.dependencies).mode).toBe("lookup");

    const file = applyPolicy(layers, filePolicy({ lookup: true, registries: ["npm"] }));
    expect(file.inputs.dependencies).toEqual({ input: "never", policy: { kind: "file", lookup: true } });
    expect(file.ignored).toEqual([{ setting: "dependencies.registries", layer: "policy-file", reason: "not-allowed" }]);
    expect(resolveDependencySettings(file.inputs.dependencies).mode).toBe("never");
  });
});
