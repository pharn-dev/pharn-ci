import { AGENT_TOOLS } from "../../setup/summary.js";
import type { PolicyRuleInput, RuleFinding } from "./types.js";

/** The detail of the P01 finding for an inventory with no agent setup file at all. */
export const NO_SETUP_DETAIL = "no agent setup files found";

/**
 * P01, required agent setup. Fires only for what the policy document itself requires (`setup.require`,
 * `setup.expect`): a requirement that came only from an input or `.pharn/ci.yml` is not the policy's.
 */
export function detectP01(input: PolicyRuleInput): RuleFinding[] {
  const { policy } = input;
  if ((policy.source !== "app" && policy.source !== "file") || policy.document === null) return [];
  const setup = policy.document.setup;
  const findings: RuleFinding[] = [];
  if (setup?.require === true && input.agentSetupFileCount === 0) {
    findings.push({ id: "P01", fallback: "block", path: null, line: null, detail: NO_SETUP_DETAIL });
  }
  const seen = new Set<string>();
  for (const tool of setup?.expect ?? []) {
    if (seen.has(tool)) continue;
    seen.add(tool);
    if ((AGENT_TOOLS as readonly string[]).includes(tool) && !input.agentTools.includes(tool)) {
      findings.push({ id: "P01", fallback: "block", path: null, line: null, detail: `no setup file for ${tool}` });
    }
  }
  return findings;
}
