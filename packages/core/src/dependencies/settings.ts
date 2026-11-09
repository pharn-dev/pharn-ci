import type { PolicyRegistry } from "../policy/types.js";

/**
 * The `dependencies` input: `auto` (the default) runs the offline checks D04 and D05; `lookup` adds the registry
 * lookups D01 to D03 (the Action only); `never` runs nothing.
 */
export type DependencyMode = "never" | "auto" | "lookup";

export const DEPENDENCY_MODES = ["auto", "lookup", "never"] as const satisfies readonly DependencyMode[];

/** The default `dependencies.min_age_days`: a package first published fewer days before HEAD is young (D02). */
export const DEFAULT_MIN_AGE_DAYS = 30;
/** The default `dependencies.min_weekly_downloads`: an npm package downloaded fewer times last week is obscure (D03). */
export const DEFAULT_MIN_WEEKLY_DOWNLOADS = 100;

export function isDependencyMode(value: unknown): value is DependencyMode {
  return typeof value === "string" && (DEPENDENCY_MODES as readonly string[]).includes(value);
}

/** The error text for a value that is not a dependencies mode; `label` names the input or the flag. */
export function dependencyModeError(label: string, value: string): string {
  return `${label} must be one of: ${DEPENDENCY_MODES.join(", ")} (got "${value}")`;
}

/**
 * The raw settings of dependency safety, each layer absent when not given: the input (or flag), `dependencies` in
 * `.pharn/ci.yml` (which the pull request carries, so it may only tighten), and the org policy's `dependencies`
 * (`app`: authoritative; `file`: carried by the pull request, so it may only tighten too). `allowedHosts` is the
 * input's list of private registry hosts D05 accepts (validated by `parseAllowedHosts`); `.pharn/ci.yml` cannot set it.
 */
export interface DependencySettingsLayers {
  input?: DependencyMode;
  allowedHosts?: string[];
  config?: { lookup?: boolean; minAgeDays?: number; minWeeklyDownloads?: number };
  policy?: {
    kind: "app" | "file";
    lookup?: boolean;
    minAgeDays?: number;
    minWeeklyDownloads?: number;
    registries?: PolicyRegistry[];
    /** Only an app policy's list is read; a file policy's is never applied. */
    allowedHosts?: string[];
  };
}

/**
 * The settings a run uses. `registries` are the ecosystems whose added packages are looked up. `allowedHosts` are the
 * private registry hosts, lower-cased and de-duplicated, whose https URLs D05 accepts besides the four public ones;
 * absent when there are none.
 */
export interface ResolvedDependencySettings {
  mode: DependencyMode;
  minAgeDays: number;
  minWeeklyDownloads: number;
  registries: PolicyRegistry[];
  allowedHosts?: string[];
}

/**
 * The effective dependency settings. The mode starts from the input (default `auto`). `dependencies.lookup: true` in
 * the config or a policy file turns lookups on over `auto`, never over `never`: `never` is the workflow's choice that the
 * job sends no package name to a registry, and a file the pull request carries cannot overrule it. An app policy that
 * has a `dependencies` key requires the check: `never` from the input becomes `auto`, and its `lookup: true` turns
 * lookups on whatever the input says. The minimums take the largest value of every layer (an app policy's value
 * replaces the default first); only an app policy narrows the registries looked up. The allowed hosts are the input's
 * list, replaced by an app policy's list when it has one; a policy file's list is never read, and the config has none.
 */
export function resolveDependencySettings(layers: DependencySettingsLayers = {}): ResolvedDependencySettings {
  let mode: DependencyMode = layers.input ?? "auto";
  if (mode === "auto" && layers.config?.lookup === true) mode = "lookup";
  const policy = layers.policy;
  if (policy !== undefined) {
    if (policy.kind === "app") {
      if (mode === "never") mode = "auto";
      if (policy.lookup === true) mode = "lookup";
    } else if (mode === "auto" && policy.lookup === true) {
      mode = "lookup";
    }
  }
  const app = policy?.kind === "app" ? policy : undefined;
  const file = policy?.kind === "file" ? policy : undefined;
  const largest = (start: number, ...values: Array<number | undefined>) =>
    values.reduce<number>((max, value) => (value !== undefined && value > max ? value : max), start);
  const hosts = [...new Set((app?.allowedHosts ?? layers.allowedHosts ?? []).map((host) => host.toLowerCase()))];
  return {
    mode,
    minAgeDays: largest(app?.minAgeDays ?? DEFAULT_MIN_AGE_DAYS, layers.config?.minAgeDays, file?.minAgeDays),
    minWeeklyDownloads: largest(
      app?.minWeeklyDownloads ?? DEFAULT_MIN_WEEKLY_DOWNLOADS,
      layers.config?.minWeeklyDownloads,
      file?.minWeeklyDownloads,
    ),
    registries:
      app?.registries === undefined
        ? ["npm", "pypi"]
        : (["npm", "pypi"] as const).filter((r) => app.registries?.includes(r)),
    ...(hosts.length === 0 ? {} : { allowedHosts: hosts }),
  };
}
