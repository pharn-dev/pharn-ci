import type { DiffFile } from "../../diff/unified.js";
import type { AgentTool } from "../../setup/summary.js";
import type { IgnoredSetting, ResolvedPolicy } from "../resolved.js";
import type { PolicyRuleId } from "../types.js";

export type PolicyViolationSeverity = "block" | "warn" | "info";

/** One finding of an org-policy rule, with its effective severity. */
export interface PolicyViolation {
  /** The policy rule id (the full union, so later rules need no new type). */
  id: PolicyRuleId;
  severity: PolicyViolationSeverity;
  path: string | null;
  /** Always null for now: the rules judge files, not lines. */
  line: number | null;
  /** 1 to 300 characters; never file contents. */
  detail: string;
}

/** What the org-policy rules read: only data the check already has. */
export interface PolicyRuleInput {
  policy: ResolvedPolicy;
  agentSetupFileCount: number;
  /** The tools the agent setup inventory configures (`summarizeAgentSetup(files).tools`). */
  agentTools: readonly AgentTool[];
  repoFiles: readonly string[];
  /** The parsed diff, or null when the diff is unavailable. */
  diff: readonly DiffFile[] | null;
  /** The repo-relative path of the config in use, or null when it is outside the repository. */
  configPath: string | null;
  /** The settings the policy beat or may not set (the policy application's `ignored`). */
  ignored: readonly IgnoredSetting[];
}

export interface PolicyEvaluation {
  violations: PolicyViolation[];
  /** How many violations of a rule a cap left out; only P08 is capped. */
  omitted: Partial<Record<PolicyRuleId, number>>;
  /** The rule ids a policy file asked to lower and that were not lowered; distinct, in id order. */
  lowered: PolicyRuleId[];
}

/** One raw finding of a rule before the policy's rule severities are applied. */
export interface RuleFinding {
  id: PolicyRuleId;
  /** The default severity of this finding's class. */
  fallback: PolicyViolationSeverity;
  path: string | null;
  detail: string;
}
