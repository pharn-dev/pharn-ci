import type { PolicyRuleId } from "../types.js";
import { detectP01 } from "./p01.js";
import { detectP08 } from "./p08.js";
import { detectP09 } from "./p09.js";
import { detectP10 } from "./p10.js";
import { detectP11 } from "./p11.js";
import { boundDetail, resolveSeverity } from "./severity.js";
import type { PolicyEvaluation, PolicyRuleInput, PolicyViolation, RuleFinding } from "./types.js";

/** The most P08 violations the report keeps; the rest are counted. */
export const MAX_P08_VIOLATIONS = 50;
/** The most P11 violations the report keeps; the rest are counted. */
export const MAX_P11_VIOLATIONS = 50;

/** The rules whose violations are capped, with the number kept. The cap is applied after the sort. */
const RULE_CAPS: Partial<Record<PolicyRuleId, number>> = { P08: MAX_P08_VIOLATIONS, P11: MAX_P11_VIOLATIONS };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Run the org-policy rules (P01, P08, P09, P10, P11) over what the check already has, apply the policy's rule
 * severities, sort, and cap P08 and P11. Pure and deterministic; the input is never mutated.
 */
export function evaluatePolicyRules(input: PolicyRuleInput): PolicyEvaluation {
  const findings: RuleFinding[] = [
    ...detectP01(input),
    ...detectP08(input),
    ...detectP09(input),
    ...detectP10(input),
    ...detectP11(input),
  ];
  const lowered = new Set<PolicyRuleId>();
  if (input.agentPolicy?.lowered === true) lowered.add("P11");
  let violations: PolicyViolation[] = [];
  for (const finding of findings) {
    if (finding.id === "P10") {
      violations.push({
        id: finding.id,
        severity: finding.fallback,
        path: finding.path,
        line: null,
        detail: finding.detail,
      });
      continue;
    }
    if (finding.id === "P11") {
      // The severity of P11 is already resolved (`agentPolicy.severity`), so the finding carries it.
      violations.push({
        id: finding.id,
        severity: finding.fallback,
        path: finding.path,
        line: null,
        detail: boundDetail(finding.detail),
      });
      continue;
    }
    const resolved = resolveSeverity(input.policy, finding.id, finding.fallback);
    if (resolved.lowered) lowered.add(finding.id);
    if (resolved.severity === null) continue;
    violations.push({
      id: finding.id,
      severity: resolved.severity,
      path: finding.path,
      line: null,
      detail: boundDetail(finding.detail),
    });
  }
  violations.sort(
    (a, b) =>
      byCodeUnit(a.id, b.id) ||
      (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : byCodeUnit(a.path, b.path)) ||
      byCodeUnit(a.detail, b.detail),
  );
  // A capped rule keeps its first violations in sorted order; the rest are counted. Path-less violations sort first, so
  // they are always kept.
  const omitted: PolicyEvaluation["omitted"] = {};
  for (const [id, cap] of Object.entries(RULE_CAPS) as [PolicyRuleId, number][]) {
    const own = violations.filter((violation) => violation.id === id);
    if (own.length <= cap) continue;
    const dropped = new Set(own.slice(cap));
    violations = violations.filter((violation) => !dropped.has(violation));
    omitted[id] = own.length - cap;
  }
  const evaluation: PolicyEvaluation = {
    violations,
    omitted,
    lowered: [...lowered].sort(byCodeUnit),
    ignored: [...(input.agentPolicy?.ignored ?? [])],
  };
  if (input.agentPr !== null && input.agentPr !== undefined) {
    evaluation.agentPr = { evidence: [...input.agentPr.evidence], incomplete: input.agentPr.incomplete };
  }
  return evaluation;
}
