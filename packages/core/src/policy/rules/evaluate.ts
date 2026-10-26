import type { PolicyRuleId } from "../types.js";
import { detectP01 } from "./p01.js";
import { detectP08 } from "./p08.js";
import { detectP09 } from "./p09.js";
import { detectP10 } from "./p10.js";
import { boundDetail, resolveSeverity } from "./severity.js";
import type { PolicyEvaluation, PolicyRuleInput, PolicyViolation, RuleFinding } from "./types.js";

/** The most P08 violations the report keeps; the rest are counted. */
export const MAX_P08_VIOLATIONS = 50;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Run the org-policy rules (P01, P08, P09, P10) over what the check already has, apply the policy's rule severities,
 * cap P08 and sort. Pure and deterministic; the input is never mutated.
 */
export function evaluatePolicyRules(input: PolicyRuleInput): PolicyEvaluation {
  const findings: RuleFinding[] = [...detectP01(input), ...detectP08(input), ...detectP09(input), ...detectP10(input)];
  const lowered = new Set<PolicyRuleId>();
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
  // The P08 findings are already distinct and sorted by path; keep the first 50 and count the rest.
  const omitted: PolicyEvaluation["omitted"] = {};
  const p08 = violations.filter((violation) => violation.id === "P08");
  if (p08.length > MAX_P08_VIOLATIONS) {
    const dropped = new Set(p08.slice(MAX_P08_VIOLATIONS));
    violations = violations.filter((violation) => !dropped.has(violation));
    omitted.P08 = p08.length - MAX_P08_VIOLATIONS;
  }
  violations.sort(
    (a, b) =>
      byCodeUnit(a.id, b.id) ||
      (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : byCodeUnit(a.path, b.path)) ||
      byCodeUnit(a.detail, b.detail),
  );
  return { violations, omitted, lowered: [...lowered].sort(byCodeUnit) };
}
