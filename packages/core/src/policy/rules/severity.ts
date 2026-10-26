import type { MessageLevel } from "../../report.js";
import type { ResolvedPolicy } from "../resolved.js";
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
