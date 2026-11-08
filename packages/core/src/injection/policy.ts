import type { PolicyFileBase } from "../policy/agents.js";
import type { IgnoredSetting, ResolvedPolicy } from "../policy/resolved.js";
import type { InjectionSignalId, PolicySeverity } from "../policy/types.js";
import { byCodeUnit } from "../text.js";

/** The prompt-injection signal ids, in order. */
export const INJECTION_SIGNAL_IDS: readonly InjectionSignalId[] = ["PI01", "PI02", "PI03", "PI04", "PI05"];

/** A finding's severity: `block` fails the check. */
export type InjectionSeverity = "block" | "warn" | "info";

/** The default severity of each signal: PI01 (invisible Unicode) blocks, the others warn. */
export const DEFAULT_INJECTION_SEVERITIES: Readonly<Record<InjectionSignalId, InjectionSeverity>> = {
  PI01: "block",
  PI02: "warn",
  PI03: "warn",
  PI04: "warn",
  PI05: "warn",
};

const RANK: Readonly<Record<PolicySeverity, number>> = { off: 0, info: 1, warn: 2, block: 3 };

/** The prompt-injection settings in effect for one run. */
export interface InjectionSettings {
  /** Extra exempt globs: an app policy's `injection.exempt`. Never from a policy file. */
  exempt: string[];
  /** Extra phrases: the policy's `injection.phrases` (a policy file's united with its merge-base list). */
  phrases: string[];
  /** The severity of each signal, or null when an app policy switched it off. */
  severities: Record<InjectionSignalId, InjectionSeverity | null>;
  /** The policy-file settings that were not applied: its exemptions (`not-allowed`) and lowered severities (`looser`). */
  ignored: IgnoredSetting[];
}

/** The strings of the lists, distinct and sorted by code unit. */
function tidy(...lists: (readonly unknown[] | undefined)[]): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) if (typeof value === "string") out.add(value);
  }
  return [...out].sort(byCodeUnit);
}

/**
 * The prompt-injection settings of a run, from the org policy's `injection` key. Without a policy document the
 * defaults apply. An app policy is authoritative: its exemptions and phrases apply and its `injection.signals` replace
 * the default severities (`off` switches a signal off). A `file:` policy is carried by the pull request, so it can only
 * tighten: its phrases apply (united with the merge-base list when the caller read it), its severities apply only above
 * the default (a lower one is recorded as `looser`), and its exemptions are never applied (recorded as `not-allowed`).
 * No other layer (inputs, `.pharn/ci.yml`) sets anything here. Pure.
 */
export function injectionSettingsOf(policy: ResolvedPolicy | undefined, base?: PolicyFileBase): InjectionSettings {
  const severities: Record<InjectionSignalId, InjectionSeverity | null> = { ...DEFAULT_INJECTION_SEVERITIES };
  const settings: InjectionSettings = { exempt: [], phrases: [], severities, ignored: [] };
  const document = policy?.document;
  if (policy === undefined || policy.source === "none" || document === null || document === undefined) return settings;
  const injection = document.injection;
  if (injection === undefined) return settings;
  const wanted = injection.signals ?? {};
  if (policy.source === "app") {
    settings.exempt = tidy(injection.exempt);
    settings.phrases = tidy(injection.phrases);
    for (const id of INJECTION_SIGNAL_IDS) {
      const value = Object.hasOwn(wanted, id) ? wanted[id] : undefined;
      if (value !== undefined) severities[id] = value === "off" ? null : value;
    }
    return settings;
  }
  // A `file:` policy.
  const basePhrases = base?.kind === "document" ? base.document.injection?.phrases : undefined;
  settings.phrases = tidy(injection.phrases, basePhrases);
  if (injection.exempt !== undefined && injection.exempt.length > 0) {
    settings.ignored.push({ setting: "injection.exempt", layer: "policy-file", reason: "not-allowed" });
  }
  for (const id of INJECTION_SIGNAL_IDS) {
    const value = Object.hasOwn(wanted, id) ? wanted[id] : undefined;
    if (value === undefined) continue;
    const fallback = DEFAULT_INJECTION_SEVERITIES[id];
    if (RANK[value] > RANK[fallback]) severities[id] = value as InjectionSeverity;
    else if (RANK[value] < RANK[fallback]) {
      settings.ignored.push({ setting: `injection.signals.${id}`, layer: "policy-file", reason: "looser" });
    }
  }
  return settings;
}
