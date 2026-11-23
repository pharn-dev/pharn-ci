import { DEFAULT_MIN_AGE_DAYS, DEFAULT_MIN_WEEKLY_DOWNLOADS } from "../dependencies/settings.js";
import { DEFAULT_INJECTION_SEVERITIES } from "../injection/policy.js";
import { byCodeUnit } from "../text.js";
import type { PolicyFileBase } from "./agents.js";
import type { IgnoredSetting, ResolvedPolicy } from "./resolved.js";
import type {
  InjectionSignalId,
  PolicyAgents,
  PolicyCoverage,
  PolicyDependencies,
  PolicyDocument,
  PolicyFlaky,
  PolicyInjection,
  PolicyProtectedPathsMode,
  PolicyRequiredHook,
  PolicySettings,
  PolicySetup,
  PolicySeverity,
  PolicyTestIntegrity,
} from "./types.js";

/** `off < info < warn < block`. */
const SEVERITY_RANK: Readonly<Record<PolicySeverity, number>> = { off: 0, info: 1, warn: 2, block: 3 };
/** `off < warn < block`, the order of `test_integrity.mode`. */
const MODE_RANK: Readonly<Record<"off" | "warn" | "block", number>> = { off: 0, warn: 1, block: 2 };
/** `warn < block`, the order of `agents.protected_paths_mode`. */
const PROTECTED_MODE_RANK: Readonly<Record<PolicyProtectedPathsMode, number>> = { warn: 0, block: 1 };

/** The result of `uniteFilePolicy`: the policy to apply, and the head-vs-base settings it can name already. */
export interface UnitedPolicy {
  policy: ResolvedPolicy;
  /** Each a `looser` record, sorted by setting, each setting once. Signals and rules are recorded where they are resolved. */
  ignored: IgnoredSetting[];
}

/** The strictest of the values that are set, on `rank`; undefined when none is. */
function strictest<T extends string>(rank: Readonly<Record<T, number>>, ...values: (T | undefined)[]): T | undefined {
  let top: T | undefined;
  for (const value of values) if (value !== undefined && (top === undefined || rank[value] > rank[top])) top = value;
  return top;
}

/** True when the head's effective value is below the base's, each at least `floor`: `max(floor, head) < max(floor, base)`. */
function belowBase<T extends string>(
  rank: Readonly<Record<T, number>>,
  floor: T,
  head: T | undefined,
  base: T | undefined,
): boolean {
  if (base === undefined) return false;
  const effective = (value: T | undefined) => Math.max(rank[floor], value === undefined ? -1 : rank[value]);
  return effective(head) < effective(base);
}

/** The larger of the numbers that are set, or undefined. */
function larger(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined ? b : b === undefined ? a : Math.max(a, b);
}

/** The smaller of the numbers that are set, or undefined. */
function smaller(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined ? b : b === undefined ? a : Math.min(a, b);
}

/** The base entries the head lacks, compared by `key`. */
function missingFromHead<T>(
  head: readonly T[] | undefined,
  base: readonly T[] | undefined,
  key: (value: T) => string,
): T[] {
  const present = new Set((head ?? []).map(key));
  const out: T[] = [];
  for (const entry of base ?? []) {
    const id = key(entry);
    if (present.has(id)) continue;
    present.add(id);
    out.push(entry);
  }
  return out;
}

/** The head's entries in order, then each base entry the head lacks; undefined when neither copy has the list. */
function union<T>(
  head: readonly T[] | undefined,
  base: readonly T[] | undefined,
  key: (value: T) => string = String,
): T[] | undefined {
  if (head === undefined && base === undefined) return undefined;
  return [...(head ?? []), ...missingFromHead(head, base, key)];
}

/** `true` when either copy says `true`; otherwise the head's value. */
function eitherTrue(head: boolean | undefined, base: boolean | undefined): boolean | undefined {
  return head === true || base === true ? true : head;
}

/** `false` when either copy says `false`; otherwise the head's value. */
function eitherFalse(head: boolean | undefined, base: boolean | undefined): boolean | undefined {
  return head === false || base === false ? false : head;
}

const hookKey = (hook: PolicyRequiredHook): string => JSON.stringify([hook.event, hook.matcher ?? null]);

/** Sets `object[key]` when `value` is set (exact optional properties: never to undefined). */
function put<T extends object, K extends keyof T>(object: T, key: K, value: NonNullable<T[K]> | undefined): void {
  if (value !== undefined) object[key] = value;
}

/** A record of `sections`, each key at its strictest of the two copies; undefined when neither copy has any. */
function strictestRecord<K extends string, V extends string>(
  rank: Readonly<Record<V, number>>,
  head: Partial<Record<K, V>> | undefined,
  base: Partial<Record<K, V>> | undefined,
): Partial<Record<K, V>> | undefined {
  if (head === undefined && base === undefined) return undefined;
  const out: Partial<Record<K, V>> = {};
  const ids = new Set([...Object.keys(head ?? {}), ...Object.keys(base ?? {})] as K[]);
  for (const id of ids) {
    const mine = head !== undefined && Object.hasOwn(head, id) ? head[id] : undefined;
    const theirs = base !== undefined && Object.hasOwn(base, id) ? base[id] : undefined;
    const value = strictest<V>(rank, mine, theirs);
    if (value !== undefined) out[id] = value;
  }
  return out;
}

/**
 * The `looser` records of the head copy against the base copy, and the united document. The comparisons are made on the
 * effective values (`max(default, value)` in the setting's own order), so a head that deletes a base value which equals
 * the default is not looser. `ignored` collects the records of the settings with a static default; the others are made
 * where the finding is resolved (see `uniteFilePolicy`).
 */
function uniteDocuments(head: PolicyDocument, base: PolicyDocument, ignored: IgnoredSetting[]): PolicyDocument {
  const looser = (setting: string) => ignored.push({ setting, reason: "looser" });
  const united: PolicyDocument = { version: head.version };

  // coverage: the threshold is the higher; exclude and root are head only (a file may not set them).
  {
    const out: PolicyCoverage = {};
    const threshold = larger(head.coverage?.threshold, base.coverage?.threshold);
    put(out, "threshold", threshold);
    put(out, "exclude", head.coverage?.exclude);
    if (head.coverage !== undefined && Object.hasOwn(head.coverage, "root"))
      out.root = head.coverage.root as string | null;
    const baseThreshold = base.coverage?.threshold;
    if (baseThreshold !== undefined && (head.coverage?.threshold ?? -Infinity) < baseThreshold) {
      looser("coverage.threshold");
    }
    if (head.coverage !== undefined || Object.keys(out).length > 0) united.coverage = out;
  }

  // setup
  {
    const h = head.setup;
    const b = base.setup;
    const out: PolicySetup = {};
    put(out, "require", eitherTrue(h?.require, b?.require));
    if (b?.require === true && h?.require !== true) looser("setup.require");
    put(out, "expect", union(h?.expect, b?.expect));
    if (missingFromHead(h?.expect, b?.expect, String).length > 0) looser("setup.expect");
    put(out, "consistency", strictest(SEVERITY_RANK, h?.consistency, b?.consistency));
    if (belowBase(SEVERITY_RANK, "warn", h?.consistency, b?.consistency)) looser("setup.consistency");
    for (const key of [
      "forbidden_permissions",
      "required_permissions_deny",
      "forbidden_mcp_servers",
      "forbidden_files",
    ] as const) {
      put(out, key, union(h?.[key], b?.[key]));
      if (missingFromHead(h?.[key], b?.[key], String).length > 0) looser(`setup.${key}`);
    }
    put(out, "required_hooks", union(h?.required_hooks, b?.required_hooks, hookKey));
    if (missingFromHead(h?.required_hooks, b?.required_hooks, hookKey).length > 0) looser("setup.required_hooks");
    // The allowlist: both lists set (non-empty) give the servers both name, or the base's list when they share none; a
    // list one copy sets is that copy's. An empty list is no list (P04 runs on a non-empty one).
    const headList = h?.allowed_mcp_servers ?? [];
    const baseList = b?.allowed_mcp_servers ?? [];
    if (h?.allowed_mcp_servers !== undefined || b?.allowed_mcp_servers !== undefined) {
      let allowed: string[];
      if (headList.length > 0 && baseList.length > 0) {
        const shared = headList.filter((server) => baseList.includes(server));
        allowed = shared.length > 0 ? [...new Set(shared)] : [...baseList];
      } else if (baseList.length > 0) {
        allowed = [...baseList];
      } else {
        allowed = [...headList];
      }
      out.allowed_mcp_servers = allowed;
      if (baseList.length > 0 && (headList.length === 0 || headList.some((server) => !baseList.includes(server)))) {
        looser("setup.allowed_mcp_servers");
      }
    }
    if (h !== undefined || Object.keys(out).length > 0) united.setup = out;
  }

  // test_integrity: the mode and the signals are the strictest; the accept label is head only.
  {
    const h = head.test_integrity;
    const b = base.test_integrity;
    const out: PolicyTestIntegrity = {};
    put(out, "mode", strictest(MODE_RANK, h?.mode, b?.mode));
    // A mode the head sets is compared with the base's mode itself (a head `off` under a base `warn` is named even when
    // the inputs give `off`); a deleted one by effective value, so a dropped base `warn`, the default, is not named.
    const modeDropped =
      h?.mode !== undefined
        ? b?.mode !== undefined && MODE_RANK[h.mode] < MODE_RANK[b.mode]
        : belowBase(MODE_RANK, "warn", undefined, b?.mode);
    if (modeDropped) looser("test_integrity.mode");
    put(out, "signals", strictestRecord(SEVERITY_RANK, h?.signals, b?.signals));
    put(out, "accept_label", h?.accept_label);
    if (h !== undefined || Object.keys(out).length > 0) united.test_integrity = out;
  }

  // flaky: a quarantine of false from either copy switches it off.
  {
    const out: PolicyFlaky = {};
    put(out, "quarantine", eitherFalse(head.flaky?.quarantine, base.flaky?.quarantine));
    if (base.flaky?.quarantine === false && head.flaky?.quarantine !== false) looser("flaky.quarantine");
    if (head.flaky !== undefined || Object.keys(out).length > 0) united.flaky = out;
  }

  // policy: the rules are the strictest; `required` is head only.
  {
    const out: PolicySettings = {};
    put(out, "required", head.policy?.required);
    put(out, "rules", strictestRecord(SEVERITY_RANK, head.policy?.rules, base.policy?.rules));
    if (head.policy !== undefined || Object.keys(out).length > 0) united.policy = out;
  }

  // agents
  {
    const h = head.agents;
    const b = base.agents;
    const out: PolicyAgents = {};
    for (const key of ["labels", "extra_logins", "protected_paths"] as const) {
      put(out, key, union(h?.[key], b?.[key]));
      if (missingFromHead(h?.[key], b?.[key], String).length > 0) looser(`agents.${key}`);
    }
    put(out, "protected_paths_mode", strictest(PROTECTED_MODE_RANK, h?.protected_paths_mode, b?.protected_paths_mode));
    // The one exception to the effective-value rule: a deleted `block` equals the default, and is named all the same.
    if (b?.protected_paths_mode === "block" && h?.protected_paths_mode !== "block") {
      looser("agents.protected_paths_mode");
    }
    put(out, "require_human_approval", eitherTrue(h?.require_human_approval, b?.require_human_approval));
    if (b?.require_human_approval === true && h?.require_human_approval !== true) {
      looser("agents.require_human_approval");
    }
    for (const key of ["max_files", "max_changed_lines"] as const) {
      put(out, key, smaller(h?.[key], b?.[key]));
      const cap = b?.[key];
      if (cap !== undefined && (h?.[key] ?? Infinity) > cap) looser(`agents.${key}`);
    }
    if (h !== undefined || Object.keys(out).length > 0) united.agents = out;
  }

  // dependencies: `registries` and `allowed_hosts` are head only (a file may not set them).
  {
    const h = head.dependencies;
    const b = base.dependencies;
    const out: PolicyDependencies = {};
    put(out, "lookup", eitherTrue(h?.lookup, b?.lookup));
    if (b?.lookup === true && h?.lookup !== true) looser("dependencies.lookup");
    put(out, "registries", h?.registries);
    put(out, "min_age_days", larger(h?.min_age_days, b?.min_age_days));
    put(out, "min_weekly_downloads", larger(h?.min_weekly_downloads, b?.min_weekly_downloads));
    put(out, "allowed_hosts", h?.allowed_hosts);
    for (const [key, fallback] of [
      ["min_age_days", DEFAULT_MIN_AGE_DAYS],
      ["min_weekly_downloads", DEFAULT_MIN_WEEKLY_DOWNLOADS],
    ] as const) {
      const given = b?.[key];
      if (given !== undefined && Math.max(fallback, h?.[key] ?? -Infinity) < Math.max(fallback, given)) {
        looser(`dependencies.${key}`);
      }
    }
    if (h !== undefined || Object.keys(out).length > 0) united.dependencies = out;
  }

  // injection: the phrases are the union, the severities the strictest; `exempt` is head only.
  {
    const h = head.injection;
    const b = base.injection;
    const out: PolicyInjection = {};
    put(out, "exempt", h?.exempt);
    put(out, "phrases", union(h?.phrases, b?.phrases));
    if (missingFromHead(h?.phrases, b?.phrases, String).length > 0) looser("injection.phrases");
    put(out, "signals", strictestRecord(SEVERITY_RANK, h?.signals, b?.signals));
    for (const id of Object.keys(DEFAULT_INJECTION_SEVERITIES) as InjectionSignalId[]) {
      const baseValue = b?.signals !== undefined && Object.hasOwn(b.signals, id) ? b.signals[id] : undefined;
      const headValue = h?.signals !== undefined && Object.hasOwn(h.signals, id) ? h.signals[id] : undefined;
      if (belowBase(SEVERITY_RANK, DEFAULT_INJECTION_SEVERITIES[id], headValue, baseValue)) {
        looser(`injection.signals.${id}`);
      }
    }
    if (h !== undefined || Object.keys(out).length > 0) united.injection = out;
  }

  return united;
}

/**
 * The `file:` policy a run applies, with the head copy the pull request carries united with the merge base's copy, key by
 * key: each setting a file may carry takes the stricter of the two copies (lists are unions, thresholds the higher, caps
 * the lower, severities the stricter), and the keys a file may not set (`coverage.exclude`, `coverage.root`,
 * `test_integrity.accept_label`, `policy.required`, `dependencies.registries`, `dependencies.allowed_hosts`,
 * `injection.exempt`) are the head's alone, so a base copy's never applies. A pull request that edits the file can
 * therefore only tighten what the check grades it by. The merge-base copy is applied for any key, whether or not the head
 * copy has its parent object.
 *
 * Every consumer reads `document`, so handing them the united policy makes the gate right everywhere at once. The two
 * copies ride along in `copies`: the records of a head value that is looser than the default or than the layers are made
 * from the head copy, never from the united value (`applyPolicy`, `resolveSeverity`, `injectionSettingsOf`).
 *
 * `ignored` names, as `looser`, each setting whose head value is looser than the base's, effective meaning
 * `max(default, value)` on the setting's own order; a head that deletes a base value equal to the default is not looser.
 * The one named exception is `agents.protected_paths_mode`: a base `block` the head deletes is recorded although `block`
 * is the default. A `test_integrity.mode` the head sets is compared with the base's mode itself, not the default (the
 * inputs can give `off`, below it). `test_integrity.signals.*` and `policy.rules.*` have no static default (the finding's severity is
 * the default), so they are compared where the finding is resolved, from `copies`.
 *
 * An app policy, a policy of source none, and a `file:` policy whose base is `absent`, `unreadable` or not read are
 * returned unchanged, with no records. Pure.
 */
export function uniteFilePolicy(policy: ResolvedPolicy, base: PolicyFileBase | undefined): UnitedPolicy {
  if (policy.source !== "file" || policy.document === null || base === undefined || base.kind !== "document") {
    return { policy, ignored: [] };
  }
  const ignored: IgnoredSetting[] = [];
  const document = uniteDocuments(policy.document, base.document, ignored);
  const seen = new Set<string>();
  const records = ignored
    .filter((record) => {
      if (seen.has(record.setting)) return false;
      seen.add(record.setting);
      return true;
    })
    .sort((a, b) => byCodeUnit(a.setting, b.setting));
  return { policy: { ...policy, document, copies: { head: policy.document, base: base.document } }, ignored: records };
}
