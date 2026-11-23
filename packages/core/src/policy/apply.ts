import { type PharnConfig, parseCoverageRoot } from "../config.js";
import type { RawInputs, ResolvedInputs } from "../inputs.js";
import type { TestIntegrityMode } from "../report.js";
import type { TestIntegrityModeSettings } from "../testIntegrityMode.js";
import { byCodeUnit } from "../text.js";
import type { PolicyFileBase } from "./agents.js";
import type { IgnoredSetting, ResolvedPolicy, SignalOverrides } from "./resolved.js";
import type { PolicyDocument } from "./types.js";
import { uniteFilePolicy } from "./unite.js";

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
  /**
   * The policy the run uses from here on, for `gatherSources` and `check()`: for a `file:` policy whose merge-base copy
   * was read as a document, the united policy (`uniteFilePolicy`); the input policy, unchanged, for every other.
   * `applyPolicy` always sets it; it is optional only so that a caller that builds the type by hand (a run with no
   * policy) need not.
   */
  policy?: ResolvedPolicy;
}

const STRICTNESS: Readonly<Record<TestIntegrityMode, number>> = { off: 0, warn: 1, block: 2 };

/**
 * The app policy's `coverage.root`, normalized. `validatePolicy` has already held it to the ROOT grammar, which is
 * stricter than `parseCoverageRoot`, so this does not throw for a served policy; if it ever did, the error names the
 * policy's setting instead of being swallowed and failing later as the run's own "coverage root".
 */
function normalizedRoot(root: string): string {
  return parseCoverageRoot(root, "the org policy's coverage.root");
}

/**
 * Applies an org policy to the layers of a run. Pure: nothing is read or changed. The precedence, key by key:
 *
 * - An app policy is authoritative for `coverage.exclude` (it replaces every lower layer's), `coverage.root` and
 *   `test_integrity.accept_label`, and raises `coverage.threshold`, `setup.require` and the mode above whatever a lower
 *   layer gave. A lower layer's value it beat is recorded as `looser`, with that layer for P09.
 * - A policy file is carried by the pull request, so it can only tighten: a higher threshold, `setup.require: true`, a
 *   stricter mode, more `setup.expect` and higher signal severities. Exclusions, a root, an accept label and
 *   `policy.required` are `not-allowed`; a lower value than the layers already give is `looser`. Both are recorded and
 *   not applied.
 * - `setup.expect` is the union of every layer. `dependencies` goes into the dependency settings layers (see
 *   `applyDependencies`; an app policy's `allowed_hosts` replaces the input's, a file's is `not-allowed`). Every other
 *   key is carried in the document, not applied.
 *
 * With `base`, the merge-base copy of a `file:` policy as the caller read it, the head copy is first united with it
 * (`uniteFilePolicy`) and the united document is what is applied and what `PolicyApplication.policy` carries, so a pull
 * request that edits the file cannot loosen any setting the file may carry. The records of a head value that is looser
 * than the layers or the default are made from the head copy; the united document adds a `looser` record for each
 * setting whose head value is looser than the base's. Without a document `base`, an app policy or no policy, nothing is
 * united and the result is the one `applyPolicy(layers, policy)` gives.
 */
export function applyPolicy(layers: PolicyLayers, policy: ResolvedPolicy, base?: PolicyFileBase): PolicyApplication {
  const united = uniteFilePolicy(policy, base);
  const applied = united.policy;
  const document = applied.document;
  if (applied.source === "none" || document === null) return { inputs: layers.resolved, ignored: [], policy: applied };
  const app = applied.source === "app";
  // What the head copy carries: the records of a value looser than the layers or the default read it, not the united one.
  const head = applied.copies?.head ?? document;
  const ignored: IgnoredSetting[] = [];
  const inputs: ResolvedInputs = { ...layers.resolved };

  applyCoverage(layers, document, head, app, inputs, ignored);
  applySetup(layers, document, head, app, inputs, ignored);
  const modeSettings = applyMode(layers, document, head, app, ignored);
  if (modeSettings !== undefined) inputs.testIntegrityMode = modeSettings;
  applyDependencies(layers, document, app, inputs, ignored);

  const integrity = document.test_integrity;
  const result: PolicyApplication = { inputs, ignored: [], policy: applied };
  if (integrity?.signals !== undefined && Object.keys(integrity.signals).length > 0) {
    result.signalOverrides = {
      kind: app ? "replace" : "raise",
      severities: { ...integrity.signals },
      ...(applied.copies === undefined
        ? {}
        : {
            copies: {
              head: { ...applied.copies.head.test_integrity?.signals },
              base: { ...applied.copies.base.test_integrity?.signals },
            },
          }),
    };
  }
  if (integrity?.accept_label !== undefined) {
    if (app) result.acceptLabel = integrity.accept_label;
    else ignored.push({ setting: "test_integrity.accept_label", reason: "not-allowed" });
  }
  if (!app && document.policy?.required !== undefined) {
    ignored.push({ setting: "policy.required", reason: "not-allowed" });
  }

  // The head-vs-base records come last, so a record with numbers (a threshold) wins over the united one without.
  ignored.push(...united.ignored);
  const seen = new Set<string>();
  result.ignored = ignored
    .filter((record) => {
      const key = `${record.setting}\u0000${record.layer ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => byCodeUnit(a.setting, b.setting) || byCodeUnit(a.layer ?? "", b.layer ?? ""));
  return result;
}

function applyCoverage(
  layers: PolicyLayers,
  document: PolicyDocument,
  headDocument: PolicyDocument,
  app: boolean,
  inputs: ResolvedInputs,
  ignored: IgnoredSetting[],
): void {
  const { config, raw, resolved } = layers;
  const coverage = document.coverage;
  if (coverage === undefined) return;

  // Threshold: the largest of the policy's and the value in force (the larger of the input and the config). An app
  // policy records the layer value it beat. A file records the head copy's value whenever it is below the threshold
  // that applies, whether the layers or the copy at the base commit (united into `theirs`) raised it, with both numbers.
  if (coverage.threshold !== undefined) {
    const theirs = coverage.threshold;
    const inForce = resolved.threshold;
    const applied = inForce === null ? theirs : Math.max(theirs, inForce);
    if (app) {
      if (inForce !== null && inForce < theirs) {
        // The layer an app policy beat: the input's, unless the config's was larger (a tie names the input).
        const inputInForce = raw.threshold !== undefined && !(Number(raw.threshold.trim()) < inForce);
        ignored.push({
          setting: "coverage.threshold",
          reason: "looser",
          layer: inputInForce ? "input" : "config",
          given: inForce,
          applied,
        });
      }
    } else {
      const headValue = headDocument.coverage?.threshold;
      if (headValue !== undefined && headValue < applied) {
        ignored.push({ setting: "coverage.threshold", reason: "looser", given: headValue, applied });
      }
    }
    inputs.threshold = applied;
  }

  // Exclusions: the app's list replaces every lower layer's; a file can add none.
  if (coverage.exclude !== undefined) {
    if (app) {
      const theirs = coverage.exclude;
      // The config's patterns come first in `resolved.exclude`, then the input's.
      const configCount = (config.coverage?.exclude ?? []).length;
      for (const layer of ["config", "input"] as const) {
        const patterns =
          layer === "config" ? resolved.exclude.slice(0, configCount) : resolved.exclude.slice(configCount);
        if (patterns.some((pattern) => !theirs.includes(pattern))) {
          ignored.push({ setting: "coverage.exclude", reason: "looser", layer });
        }
      }
      inputs.exclude = [...theirs];
    } else if (coverage.exclude.length > 0) {
      ignored.push({ setting: "coverage.exclude", reason: "not-allowed" });
    }
  }

  // Root: authoritative from the app (null is the repository root); never applied from a file. `resolved.coverageRoot`
  // is the input's root, else the config's, and undefined when neither gave one.
  if (coverage.root !== undefined) {
    if (app) {
      const theirs = coverage.root === null ? "." : normalizedRoot(coverage.root);
      if (resolved.coverageRoot !== undefined && resolved.coverageRoot !== theirs) {
        ignored.push({
          setting: "coverage.root",
          reason: "looser",
          layer: raw.coverageRoot !== undefined ? "input" : "config",
        });
      }
      inputs.coverageRoot = theirs === "." ? undefined : theirs;
    } else {
      ignored.push({ setting: "coverage.root", reason: "not-allowed" });
    }
  }
}

function applySetup(
  layers: PolicyLayers,
  document: PolicyDocument,
  headDocument: PolicyDocument,
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
      // Only a false in force is beaten: when either layer says true, the requirement was already on. The input's
      // false is named first, as it was when both say false.
      const layer = raw.requireAgentSetup === false ? "input" : config.setup?.require === false ? "config" : undefined;
      if (app && !resolved.requireAgentSetup && layer !== undefined) {
        ignored.push({ setting: "setup.require", reason: "looser", layer });
      }
      inputs.requireAgentSetup = true;
    }
  }
  // A file's `false` over a requirement the layers give is `looser`, whether or not the merge-base copy's `true` made the
  // united value true: the record reads the head copy.
  if (!app && headDocument.setup?.require === false && resolved.requireAgentSetup) {
    ignored.push({ setting: "setup.require", reason: "looser" });
  }

  // setup.expect: the union of every layer, the lower ones first, each once; absent when empty.
  if (setup.expect !== undefined) {
    const union = [...new Set([...(resolved.expectAgentSetup ?? []), ...setup.expect])];
    if (union.length > 0) inputs.expectAgentSetup = union;
  }
}

/**
 * The policy's `dependencies` added to the dependency settings (A13; `resolveDependencySettings` applies them). An app
 * policy with the key requires the check, so a `never` input is beaten and recorded `looser`. A policy file may only
 * tighten: its `registries` would narrow what is looked up, and its `allowed_hosts` would loosen D05, so both are
 * `not-allowed`. An app policy's `allowed_hosts` replaces the input's list (see `resolveDependencySettings`); each input
 * host it does not name makes one `looser` record, `dependencies.allowed_hosts`.
 */
function applyDependencies(
  layers: PolicyLayers,
  document: PolicyDocument,
  app: boolean,
  inputs: ResolvedInputs,
  ignored: IgnoredSetting[],
): void {
  const deps = document.dependencies;
  if (deps === undefined) return;
  const given = layers.resolved.dependencies;
  if (app && given?.input === "never") ignored.push({ setting: "dependencies", reason: "looser", layer: "input" });
  if (!app && deps.registries !== undefined) {
    ignored.push({ setting: "dependencies.registries", reason: "not-allowed" });
  }
  // Allowed registry hosts: an app policy's list replaces the input's (an input host it leaves out is `looser`, named by
  // setting only, never by host); a policy file may allow no host, so a non-empty list is `not-allowed`.
  if (deps.allowed_hosts !== undefined) {
    if (app) {
      const named = deps.allowed_hosts.map((host) => host.toLowerCase());
      if ((given?.allowedHosts ?? []).some((host) => !named.includes(host))) {
        ignored.push({ setting: "dependencies.allowed_hosts", reason: "looser", layer: "input" });
      }
    } else if (deps.allowed_hosts.length > 0) {
      ignored.push({ setting: "dependencies.allowed_hosts", reason: "not-allowed" });
    }
  }
  inputs.dependencies = {
    ...given,
    policy: {
      kind: app ? "app" : "file",
      ...(deps.lookup === undefined ? {} : { lookup: deps.lookup }),
      ...(deps.min_age_days === undefined ? {} : { minAgeDays: deps.min_age_days }),
      ...(deps.min_weekly_downloads === undefined ? {} : { minWeeklyDownloads: deps.min_weekly_downloads }),
      ...(app && deps.registries !== undefined ? { registries: [...deps.registries] } : {}),
      ...(app && deps.allowed_hosts !== undefined ? { allowedHosts: [...deps.allowed_hosts] } : {}),
    },
  };
}

/**
 * The mode settings with the policy's mode added, and a record when it beat a looser mode. Undefined when the policy
 * names no mode: the settings are then the resolved ones, untouched.
 */
function applyMode(
  layers: PolicyLayers,
  document: PolicyDocument,
  headDocument: PolicyDocument,
  app: boolean,
  ignored: IgnoredSetting[],
): TestIntegrityModeSettings | undefined {
  const given = layers.resolved.testIntegrityMode;
  const mode = document.test_integrity?.mode;
  if (mode === undefined) return given;
  if (app) {
    for (const layer of ["config", "input"] as const) {
      const value = given?.[layer];
      if (value !== undefined && STRICTNESS[value] < STRICTNESS[mode]) {
        ignored.push({ setting: "test_integrity.mode", reason: "looser", layer });
      }
    }
  } else {
    // What the input and the config already give (the config can only raise the input, which defaults to warn).
    // A looser file mode is recorded over the default too, not only over a set input or config (review finding 14).
    const inForce = given?.input ?? "warn";
    const today =
      given?.config !== undefined && STRICTNESS[given.config] > STRICTNESS[inForce] ? given.config : inForce;
    // The head copy's mode: the united one may be the merge base's, which is never looser than the layers.
    const headMode = headDocument.test_integrity?.mode;
    if (headMode !== undefined && STRICTNESS[headMode] < STRICTNESS[today]) {
      ignored.push({ setting: "test_integrity.mode", reason: "looser" });
    }
  }
  return { ...given, policy: { mode, kind: app ? "app" : "file" } };
}
