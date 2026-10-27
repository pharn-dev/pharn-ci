import type { MessageLevel } from "../../report.js";
import type { IgnoredSetting, ResolvedPolicy } from "../resolved.js";
import type { PolicyRuleId, PolicySeverity } from "../types.js";
import type { PolicyViolationSeverity } from "./types.js";

/** `off < info < warn < block`. */
const RANK: Record<PolicySeverity, number> = { off: 0, info: 1, warn: 2, block: 3 };

/** The longest `detail` a violation may carry (the schema's `maxLength`). */
const MAX_DETAIL = 300;

/**
 * The severity a rule's finding gets: the policy's `policy.rules` value for the id, or the finding's default. `null`
 * means the rule is off, so there is no violation. A policy from the app replaces the default; a policy file can only
 * raise it, and a lower value is reported as `lowered` and not applied. Only P01, P08 and P09 reach this function.
 */
export function resolveSeverity(
  policy: ResolvedPolicy,
  id: PolicyRuleId,
  fallback: PolicyViolationSeverity,
): { severity: PolicyViolationSeverity | null; lowered: boolean } {
  const rules = policy.document?.policy?.rules;
  const value = rules !== undefined && Object.hasOwn(rules, id) ? rules[id] : undefined;
  if (value === undefined) return { severity: fallback, lowered: false };
  if (policy.source === "app") {
    return value === "off" ? { severity: null, lowered: false } : { severity: value, lowered: false };
  }
  if (policy.source === "file") {
    if (RANK[value] > RANK[fallback]) return { severity: value as PolicyViolationSeverity, lowered: false };
    if (RANK[value] < RANK[fallback]) return { severity: fallback, lowered: true };
    return { severity: fallback, lowered: false };
  }
  return { severity: fallback, lowered: false };
}

/**
 * The severity of a rule that has a second, feature-specific setting next to `policy.rules.<id>` (P11 and its
 * `agents.protected_paths_mode`). `fallback` is the default of the finding's class. An app policy: with neither value
 * set the fallback applies, with one set that value applies (`off` means no violation), with both set the stricter of
 * the two applies. A policy file can only raise: the result is the strictest of the fallback and every set value and is
 * never null; a feature value below the fallback is recorded in `ignored`, and a `policy.rules` value below it is
 * reported as `lowered`. Without a policy document the fallback applies and nothing is recorded.
 */
export function resolveKeyedSeverity(
  policy: ResolvedPolicy,
  id: PolicyRuleId,
  keyed: { featureValue: PolicySeverity | undefined; featureSetting: string; fallback: PolicyViolationSeverity },
): { severity: PolicyViolationSeverity | null; ignored: IgnoredSetting[]; lowered: boolean } {
  const { featureValue, featureSetting, fallback } = keyed;
  const rules = policy.document?.policy?.rules;
  const ruleValue = rules !== undefined && Object.hasOwn(rules, id) ? rules[id] : undefined;
  const none = { severity: fallback, ignored: [] as IgnoredSetting[], lowered: false };
  if (policy.document === null || policy.document === undefined) return none;
  if (policy.source === "app") {
    const set = [featureValue, ruleValue].filter((value): value is PolicySeverity => value !== undefined);
    if (set.length === 0) return none;
    if (set.length === 1) {
      const only = set[0] as PolicySeverity;
      return { severity: only === "off" ? null : only, ignored: [], lowered: false };
    }
    const strict = RANK[set[0] as PolicySeverity] >= RANK[set[1] as PolicySeverity] ? set[0] : set[1];
    return { severity: strict === "off" ? null : (strict as PolicyViolationSeverity), ignored: [], lowered: false };
  }
  if (policy.source === "file") {
    let severity: PolicyViolationSeverity = fallback;
    for (const value of [featureValue, ruleValue]) {
      if (value !== undefined && RANK[value] > RANK[severity]) severity = value as PolicyViolationSeverity;
    }
    const ignored: IgnoredSetting[] =
      featureValue !== undefined && RANK[featureValue] < RANK[fallback]
        ? [{ setting: featureSetting, layer: "policy-file", reason: "looser" }]
        : [];
    const lowered = ruleValue !== undefined && RANK[ruleValue] < RANK[fallback];
    return { severity, ignored, lowered };
  }
  return none;
}

/** The message level of a violation severity. */
export function levelOf(severity: PolicyViolationSeverity): MessageLevel {
  return severity === "block" ? "error" : severity === "warn" ? "warn" : "info";
}

/** The highest severity of a non-empty list. */
export function strongest(severities: readonly PolicyViolationSeverity[]): PolicyViolationSeverity {
  let top: PolicyViolationSeverity = "info";
  for (const severity of severities) if (RANK[severity] > RANK[top]) top = severity;
  return top;
}

/** Text of at most 300 characters: a longer one is cut (not inside a surrogate pair) and ends with `…`. */
export function boundDetail(text: string): string {
  if (text.length <= MAX_DETAIL) return text;
  const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
  const end = high(text.charCodeAt(MAX_DETAIL - 2)) ? MAX_DETAIL - 2 : MAX_DETAIL - 1;
  return `${text.slice(0, end)}…`;
}
