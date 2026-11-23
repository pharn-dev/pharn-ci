import type { MessageLevel } from "../../report.js";
import { cutCodeUnits } from "../../text.js";
import type { IgnoredSetting, ResolvedPolicy } from "../resolved.js";
import type { PolicyDocument, PolicyRuleId, PolicySeverity } from "../types.js";
import type { PolicyViolationSeverity } from "./types.js";

/** `off < info < warn < block`. */
const RANK: Record<PolicySeverity, number> = { off: 0, info: 1, warn: 2, block: 3 };

/** The longest `detail` a violation may carry (the schema's `maxLength`). */
const MAX_DETAIL = 300;

/**
 * The severity a rule's finding gets: the policy's `policy.rules` value for the id, or the finding's default. `null`
 * means the rule is off, so there is no violation. A policy from the app replaces the default; a policy file can only
 * raise it, and a lower value is reported as `lowered` and not applied. Every rule but P10 reaches this function.
 * For a `file:` policy united with its merge-base copy (`policy.copies`), the severity reads the united value (the
 * strictest of the two copies) and `lowered` reads the copies: the head copy's value is below the fallback, or its
 * effective value `max(fallback, head)` is below the base copy's.
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
    const lowered = ruleLowered(policy, id, fallback);
    if (RANK[value] > RANK[fallback]) return { severity: value as PolicyViolationSeverity, lowered };
    return { severity: fallback, lowered };
  }
  return { severity: fallback, lowered: false };
}

/** A rule value of one copy of a policy document. */
function ruleOf(document: PolicyDocument | undefined, id: PolicyRuleId): PolicySeverity | undefined {
  const rules = document?.policy?.rules;
  return rules !== undefined && Object.hasOwn(rules, id) ? rules[id] : undefined;
}

/** `max(floor, value)` on the severity order; a value that is not set counts as the floor. */
function effectiveRank(floor: PolicyViolationSeverity, value: PolicySeverity | undefined): number {
  return Math.max(RANK[floor], value === undefined ? -1 : RANK[value]);
}

/**
 * Whether a `file:` policy's value of `policy.rules.<id>` was looser than what applies: the head copy's value is below
 * `fallback`, or, with the merge-base copy united in, its effective value is below the base copy's. Without `copies` the
 * document is the head copy.
 */
function ruleLowered(policy: ResolvedPolicy, id: PolicyRuleId, fallback: PolicyViolationSeverity): boolean {
  const head = ruleOf(policy.copies?.head ?? policy.document ?? undefined, id);
  if (head !== undefined && RANK[head] < RANK[fallback]) return true;
  if (policy.copies === undefined) return false;
  return effectiveRank(fallback, head) < effectiveRank(fallback, ruleOf(policy.copies.base, id));
}

/**
 * The severity of a rule that has a second, feature-specific setting next to `policy.rules.<id>` (P11 and its
 * `agents.protected_paths_mode`). `fallback` is the default of the finding's class. An app policy: with neither value
 * set the fallback applies, with one set that value applies (`off` means no violation), with both set the stricter of
 * the two applies. A policy file can only raise: the result is the strictest of the fallback and every set value and is
 * never null; a feature value below the fallback is recorded in `ignored`, and a `policy.rules` value below it is
 * reported as `lowered`. Without a policy document the fallback applies and nothing is recorded. `feature` reads the
 * setting from a document; with `policy.copies` the severity reads the united document and the records read the head
 * copy (a feature value below the fallback) and both copies (`lowered`, as `resolveSeverity`).
 */
export function resolveKeyedSeverity(
  policy: ResolvedPolicy,
  id: PolicyRuleId,
  keyed: {
    feature: (document: PolicyDocument) => PolicySeverity | undefined;
    featureSetting: string;
    fallback: PolicyViolationSeverity;
  },
): { severity: PolicyViolationSeverity | null; ignored: IgnoredSetting[]; lowered: boolean } {
  const { feature, featureSetting, fallback } = keyed;
  const rules = policy.document?.policy?.rules;
  const ruleValue = rules !== undefined && Object.hasOwn(rules, id) ? rules[id] : undefined;
  const none = { severity: fallback, ignored: [] as IgnoredSetting[], lowered: false };
  if (policy.document === null || policy.document === undefined) return none;
  // The feature value that applies is the document's (united with the merge-base copy for a `file:` policy that has one);
  // the one a record is made from is the head copy's.
  const featureValue = feature(policy.document);
  const headFeatureValue = feature(policy.copies?.head ?? policy.document);
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
      headFeatureValue !== undefined && RANK[headFeatureValue] < RANK[fallback]
        ? [{ setting: featureSetting, reason: "looser" }]
        : [];
    return { severity, ignored, lowered: ruleValue !== undefined && ruleLowered(policy, id, fallback) };
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
  return cutCodeUnits(text, MAX_DETAIL);
}
