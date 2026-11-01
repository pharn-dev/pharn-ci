import type { DiffFile } from "../diff/unified.js";
import type { IgnoredSetting, ResolvedPolicy } from "./resolved.js";
import { resolveKeyedSeverity } from "./rules/severity.js";
import type { PolicyViolationSeverity } from "./rules/types.js";
import type { PolicyDocument } from "./types.js";

/**
 * The `file:` policy as the merge base has it, read by the caller from committed objects: a valid document, no file at
 * that path (`absent`), or a file that could not be read or is not a valid policy (`unreadable`).
 */
export type PolicyFileBase =
  | { kind: "document"; document: PolicyDocument }
  | { kind: "absent" }
  | { kind: "unreadable" };

/** The agent settings in effect for one run, derived from the resolved policy. */
export interface AgentPolicy {
  /** Extra agent labels; distinct, sorted by code unit. */
  labels: string[];
  /** Extra agent logins; distinct, sorted by code unit. */
  extraLogins: string[];
  /** The globs of the paths an agent PR may not change; distinct, sorted by code unit. */
  protectedPaths: string[];
  /** The severity of rule P11, or null when the rule does not run (no protected path, or switched off). */
  severity: PolicyViolationSeverity | null;
  /** True when a `file:` policy the pull request may have edited could not be read at the merge base. */
  listsIncomplete: boolean;
  /** Whether the diff edits the policy file; `"unknown"` when there is no diff. */
  policyFileEdited: boolean | "unknown";
  /** The P11 settings a policy file asked to lower and that were not applied. */
  ignored: IgnoredSetting[];
  /** True when a policy file's `policy.rules.P11` asked for less than block and was not applied. */
  lowered: boolean;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The strings of a list, distinct and sorted by code unit. */
function tidy(...lists: (readonly unknown[] | undefined)[]): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) if (typeof value === "string") out.add(value);
  }
  return [...out].sort(byCodeUnit);
}

/**
 * The effective agent policy of a run: the labels, logins and protected paths of the org policy, and the severity of
 * rule P11. An app policy's lists are its own. A `file:` policy's lists are its head lists united with the ones the
 * merge base has (`from.base`), whether or not the pull request edits the file, so an edit cannot remove an entry; a
 * base that cannot be read, with an edited or unknown policy file, makes the lists incomplete. Pure: nothing is read
 * but the arguments.
 */
export function agentPolicyOf(
  policy: ResolvedPolicy | undefined,
  from: { base: PolicyFileBase | undefined; diff: readonly DiffFile[] | null },
): AgentPolicy {
  const empty: AgentPolicy = {
    labels: [],
    extraLogins: [],
    protectedPaths: [],
    severity: null,
    listsIncomplete: false,
    policyFileEdited: false,
    ignored: [],
    lowered: false,
  };
  if (policy === undefined || policy.source === "none" || policy.document === null || policy.document === undefined) {
    return empty;
  }
  const head = policy.document.agents;
  let policyFileEdited: boolean | "unknown" = false;
  let baseAgents: PolicyDocument["agents"];
  let listsIncomplete = false;
  if (policy.source === "file") {
    if (from.diff === null) policyFileEdited = "unknown";
    else {
      policyFileEdited = from.diff.some((entry) => entry.path === policy.path || entry.oldPath === policy.path);
    }
    if (from.base !== undefined && from.base.kind === "document") baseAgents = from.base.document.agents;
    listsIncomplete = (from.base === undefined || from.base.kind === "unreadable") && policyFileEdited !== false;
  }
  const labels = tidy(head?.labels, baseAgents?.labels);
  const extraLogins = tidy(head?.extra_logins, baseAgents?.extra_logins);
  const protectedPaths = tidy(head?.protected_paths, baseAgents?.protected_paths);
  if (protectedPaths.length === 0) {
    return { ...empty, labels, extraLogins, listsIncomplete, policyFileEdited };
  }
  const resolved = resolveKeyedSeverity(policy, "P11", {
    featureValue: head?.protected_paths_mode,
    featureSetting: "agents.protected_paths_mode",
    fallback: "block",
  });
  return {
    labels,
    extraLogins,
    protectedPaths,
    severity: resolved.severity,
    listsIncomplete,
    policyFileEdited,
    ignored: resolved.ignored,
    lowered: resolved.lowered,
  };
}
