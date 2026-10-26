import type { PolicyRuleInput, RuleFinding } from "./types.js";

/**
 * P10, policy unavailable: the org policy could not be read. Its message is the existing POLICY_UNAVAILABLE, so this
 * finding only feeds the report's `policy` object. Block when the workflow demanded a policy, else warn.
 */
export function detectP10(input: PolicyRuleInput): RuleFinding[] {
  const unavailable = input.policy.unavailable;
  if (unavailable === undefined) return [];
  return [
    {
      id: "P10",
      fallback: unavailable.required ? "block" : "warn",
      path: null,
      detail: `org policy could not be read (${unavailable.reason})`,
    },
  ];
}
