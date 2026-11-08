import type { PolicyRegistry } from "../policy/types.js";
import { byCodeUnit } from "../text.js";
import { isReportableNpmName, isReportablePypiName, isScopedNpmName, normalizePypiName } from "./names.js";
import type { DependencyEcosystem, ManifestDependency } from "./types.js";

/** The most packages one run looks up (each npm package is one or two requests, a PyPI package one). */
export const MAX_LOOKUPS = 50;

/** One package to look up: the ecosystem and the name as the registry knows it. */
export interface PlannedLookup {
  ecosystem: DependencyEcosystem;
  name: string;
}

/** What the Action found for one planned package (see registry.ts). Times are milliseconds since the epoch. */
export interface DependencyLookupResult {
  ecosystem: DependencyEcosystem;
  name: string;
  outcome: "found" | "not-found" | "unavailable";
  /** For `found`: the first-publish time, or null when the answer did not say. */
  firstPublished?: number | null;
  /** For a `found` npm package: last week's downloads, null when the API had no count, absent when not asked. */
  weeklyDownloads?: number | null | "unavailable";
}

/** The registry lookups of a run: the HEAD commit time (from git, never the clock) and one result per planned package. */
export interface DependencyLookups {
  headTime: number | null;
  results: readonly DependencyLookupResult[];
}

/**
 * The name a registry knows an added dependency by, or null when it is not looked up: npm `npm:` aliases are looked up
 * by their target; `workspace:` packages, scoped npm names (they may name a private package), non-registry specs and
 * names that fail the allow-list are never looked up. PyPI names are normalized.
 */
export function lookupName(ecosystem: DependencyEcosystem, dep: ManifestDependency): string | null {
  if (!dep.named || dep.kind !== "registry") return null;
  if (ecosystem === "pypi") return isReportablePypiName(dep.name) ? normalizePypiName(dep.name) : null;
  const spec = dep.spec.trim();
  if (spec.toLowerCase().startsWith("workspace:")) return null;
  let name = dep.name;
  if (spec.toLowerCase().startsWith("npm:")) {
    const target = spec.slice(4);
    const at = target.indexOf("@", 1);
    name = at === -1 ? target : target.slice(0, at);
  }
  return isReportableNpmName(name) && !isScopedNpmName(name) ? name : null;
}

/**
 * The packages to look up, once each, in ecosystem then name order, and how many more there were than `MAX_LOOKUPS`.
 * `added` are the dependencies the pull request added (a version change of a package already there is not looked up: the
 * package was there before); `offRegistry` names (`ecosystem:name`) a lockfile resolves outside the registries are left
 * out (D05 judges them, and a private package name must not reach a public registry); so are ecosystems the org policy's
 * `dependencies.registries` leaves out.
 */
export function planLookups(
  added: readonly { ecosystem: DependencyEcosystem; dep: ManifestDependency }[],
  offRegistry: ReadonlySet<string>,
  registries: readonly PolicyRegistry[],
): { planned: PlannedLookup[]; overCap: number } {
  const keys = new Map<string, PlannedLookup>();
  for (const { ecosystem, dep } of added) {
    if (!registries.includes(ecosystem)) continue;
    const name = lookupName(ecosystem, dep);
    if (name === null) continue;
    const key = `${ecosystem}:${name}`;
    if (offRegistry.has(key) || keys.has(key)) continue;
    keys.set(key, { ecosystem, name });
  }
  const all = [...keys.values()].sort((a, b) => byCodeUnit(a.ecosystem, b.ecosystem) || byCodeUnit(a.name, b.name));
  return { planned: all.slice(0, MAX_LOOKUPS), overCap: Math.max(0, all.length - MAX_LOOKUPS) };
}
