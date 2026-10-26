import { type PharnConfig, parseCoverageRoot } from "../config.js";
import type { RawInputs, ResolvedInputs } from "../inputs.js";
import type { TestIntegrityMode } from "../report.js";
import type { TestIntegrityModeSettings } from "../testIntegrityMode.js";
import type { IgnoredSetting, ResolvedPolicy, SignalOverrides } from "./resolved.js";
import type { PolicyDocument } from "./types.js";

/**
 * The layers a policy is applied to, as the adapters build them: the parsed `.pharn/ci.yml`, the raw inputs as the
 * flags or the Action inputs gave them (they tell which layer gave a value), and what `resolveInputs` made of both.
 */
export interface PolicyLayers {
  config: PharnConfig;
  raw: RawInputs;
  resolved: ResolvedInputs;
}

/** The effective settings after the policy, the settings it beat or may not set, and what `check()` and the Action still need. */
export interface PolicyApplication {
  /** The settings a run uses: `layers.resolved` with the policy applied. Unchanged for a policy of source none. */
  inputs: ResolvedInputs;
  /** Sorted by setting, then layer, each pair once. */
  ignored: IgnoredSetting[];
  /** Per-signal severities for `check()`, absent when the policy sets none. */
  signalOverrides?: SignalOverrides;
  /** The accept label an app policy sets; never set from a policy file. */
  acceptLabel?: string;
}

const STRICTNESS: Readonly<Record<TestIntegrityMode, number>> = { off: 0, warn: 1, block: 2 };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A root as a comparable string: the repo root (undefined, null or `.`) is `.`. */
function rootKey(root: string | null | undefined): string {
  return root === undefined || root === null ? "." : root;
}

function normalizedRoot(root: string): string {
  try {
    return parseCoverageRoot(root, "coverage root");
  } catch {
    return root;
  }
}

/**
 * Applies an org policy to the layers of a run. Pure: nothing is read or changed. The precedence, key by key:
 *
 * - An app policy is authoritative for `coverage.exclude` (it replaces every lower layer's), `coverage.root` and
 *   `test_integrity.accept_label`, and raises `coverage.threshold`, `setup.require` and the mode above whatever a lower
 *   layer gave. A lower layer's value it beat is recorded as `looser`.
 * - A policy file is carried by the pull request, so it can only tighten: a higher threshold, `setup.require: true`, a
 *   stricter mode, more `setup.expect` and higher signal severities. Exclusions, a root, an accept label and
 *   `policy.required` are `not-allowed`; a lower value than the layers already give is `looser`. Both are recorded and
 *   not applied.
 * - `setup.expect` is the union of every layer. Every other key is carried in the document, not applied.
 */
export function applyPolicy(layers: PolicyLayers, policy: ResolvedPolicy): PolicyApplication {
  const document = policy.document;
  if (policy.source === "none" || document === null) return { inputs: layers.resolved, ignored: [] };
  const app = policy.source === "app";
  const policyLayer = "policy-file" as const;
  const ignored: IgnoredSetting[] = [];
  const inputs: ResolvedInputs = { ...layers.resolved };

  applyCoverage(layers, document, app, inputs, ignored);
  applySetup(layers, document, app, inputs, ignored);
  const modeSettings = applyMode(layers, document, app, ignored);
  if (modeSettings !== undefined) inputs.testIntegrityMode = modeSettings;

  const integrity = document.test_integrity;
  const result: PolicyApplication = { inputs, ignored: [] };
  if (integrity?.signals !== undefined && Object.keys(integrity.signals).length > 0) {
    result.signalOverrides = { kind: app ? "replace" : "raise", severities: { ...integrity.signals } };
  }
  if (integrity?.accept_label !== undefined) {
    if (app) result.acceptLabel = integrity.accept_label;
    else ignored.push({ setting: "test_integrity.accept_label", layer: policyLayer, reason: "not-allowed" });
  }
  if (!app && document.policy?.required !== undefined) {
    ignored.push({ setting: "policy.required", layer: policyLayer, reason: "not-allowed" });
  }

  const seen = new Set<string>();
  result.ignored = ignored
    .filter((record) => {
      const key = `${record.setting}\u0000${record.layer}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => byCodeUnit(a.setting, b.setting) || byCodeUnit(a.layer, b.layer));
  return result;
}

function applyCoverage(
  layers: PolicyLayers,
  document: PolicyDocument,
  app: boolean,
  inputs: ResolvedInputs,
  ignored: IgnoredSetting[],
): void {
  const { config, raw, resolved } = layers;
  const coverage = document.coverage;
  if (coverage === undefined) return;

  // Threshold: the largest of the policy's and the value in force (the input, else the config).
  if (coverage.threshold !== undefined) {
    const theirs = coverage.threshold;
    const inForce = resolved.threshold;
    if (inForce === null) {
      inputs.threshold = theirs;
    } else {
      if (app && inForce < theirs) {
        ignored.push({
          setting: "coverage.threshold",
          layer: raw.threshold !== undefined ? "input" : "config",
          reason: "looser",
          given: inForce,
          applied: theirs,
        });
      } else if (!app && theirs < inForce) {
        ignored.push({
          setting: "coverage.threshold",
          layer: "policy-file",
          reason: "looser",
          given: theirs,
          applied: inForce,
        });
      }
      inputs.threshold = Math.max(theirs, inForce);
    }
  }

  // Exclusions: the app's list replaces every lower layer's; a file can add none.
  if (coverage.exclude !== undefined) {
    if (app) {
      const theirs = coverage.exclude;
      const configCount = (config.coverage?.exclude ?? []).length;
      const fromConfig = resolved.exclude.slice(0, configCount);
      const fromInput = resolved.exclude.slice(configCount);
      for (const [layer, patterns] of [
        ["config", fromConfig],
        ["input", fromInput],
      ] as const) {
        if (patterns.some((pattern) => !theirs.includes(pattern))) {
          ignored.push({ setting: "coverage.exclude", layer, reason: "looser" });
        }
      }
      inputs.exclude = [...theirs];
    } else if (coverage.exclude.length > 0) {
      ignored.push({ setting: "coverage.exclude", layer: "policy-file", reason: "not-allowed" });
    }
  }

  // Root: authoritative from the app (null is the repository root); never applied from a file.
  if (coverage.root !== undefined) {
    if (app) {
      const theirs = coverage.root === null ? "." : normalizedRoot(coverage.root);
      const inputGiven = raw.coverageRoot !== undefined;
      const configGiven = config.coverage?.root !== undefined;
      if (inputGiven || configGiven) {
        const today = inputGiven ? rootKey(resolved.coverageRoot) : rootKey(config.coverage?.root);
        if (today !== theirs) {
          ignored.push({ setting: "coverage.root", layer: inputGiven ? "input" : "config", reason: "looser" });
        }
      }
      inputs.coverageRoot = theirs === "." ? undefined : theirs;
    } else {
      ignored.push({ setting: "coverage.root", layer: "policy-file", reason: "not-allowed" });
    }
  }
}

function applySetup(
  layers: PolicyLayers,
  document: PolicyDocument,
  app: boolean,
  inputs: ResolvedInputs,
  ignored: IgnoredSetting[],
): void {
  const { config, raw, resolved } = layers;
  const setup = document.setup;
  if (setup === undefined) return;

  // setup.require: true wins over any lower false; false changes nothing.
  if (setup.require !== undefined) {
    if (setup.require) {
      const inputGiven = raw.requireAgentSetup !== undefined;
      const lower = inputGiven ? raw.requireAgentSetup : config.setup?.require;
      if (app && lower === false) {
        ignored.push({ setting: "setup.require", layer: inputGiven ? "input" : "config", reason: "looser" });
      }
      inputs.requireAgentSetup = true;
    } else if (!app && resolved.requireAgentSetup) {
      ignored.push({ setting: "setup.require", layer: "policy-file", reason: "looser" });
    }
  }

  // setup.expect: the union of every layer, the lower ones first, each once; absent when empty.
  if (setup.expect !== undefined) {
    const union = [...new Set([...(resolved.expectAgentSetup ?? []), ...setup.expect])];
    if (union.length > 0) inputs.expectAgentSetup = union;
  }
}

/**
 * The mode settings with the policy's mode added, and the records of the layers it beat. Undefined when the policy
 * names no mode: the settings are then the resolved ones, untouched.
 */
function applyMode(
  layers: PolicyLayers,
  document: PolicyDocument,
  app: boolean,
  ignored: IgnoredSetting[],
): TestIntegrityModeSettings | undefined {
  const given = layers.resolved.testIntegrityMode;
  const mode = document.test_integrity?.mode;
  if (mode === undefined) return given;
  if (app) {
    for (const [layer, value] of [
      ["config", given?.config],
      ["input", given?.input],
    ] as const) {
      if (value !== undefined && STRICTNESS[value] < STRICTNESS[mode]) {
        ignored.push({ setting: "test_integrity.mode", layer, reason: "looser" });
      }
    }
  } else {
    // What the input and the config already give (the config can only raise the input, which defaults to warn).
    const inForce = given?.input ?? "warn";
    const today =
      given?.config !== undefined && STRICTNESS[given.config] > STRICTNESS[inForce] ? given.config : inForce;
    if ((given?.input !== undefined || given?.config !== undefined) && STRICTNESS[mode] < STRICTNESS[today]) {
      ignored.push({ setting: "test_integrity.mode", layer: "policy-file", reason: "looser" });
    }
  }
  return { ...given, policy: { mode, kind: app ? "app" : "file" } };
}
