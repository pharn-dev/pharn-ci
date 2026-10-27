import type { AgentEvidence, AgentPrDetection, AgentPrIncomplete } from "../../agents.js";
import type { DiffFile } from "../../diff/unified.js";
import type { AgentTool } from "../../setup/summary.js";
import type { AgentPolicy } from "../agents.js";
import type { IgnoredSetting, ResolvedPolicy } from "../resolved.js";
import type { PolicySettingsOutcome, PolicySettingsSources } from "../settings/types.js";
import type { PolicyRuleId } from "../types.js";

export type PolicyViolationSeverity = "block" | "warn" | "info";

/** One finding of an org-policy rule, with its effective severity. */
export interface PolicyViolation {
  /** The policy rule id (the full union, so later rules need no new type). */
  id: PolicyRuleId;
  severity: PolicyViolationSeverity;
  path: string | null;
  /**
   * The 1-based line of the entry or key the finding sits at; null when the finding is about a whole file, a missing
   * item or no file.
   */
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
  /** The agent PR detection of the run (one detection per check); absent when no PR facts were given. */
  agentPr?: AgentPrDetection | null;
  /** The effective agent policy (see `agentPolicyOf`); absent when no PR facts were given. */
  agentPolicy?: AgentPolicy;
  /**
   * The committed agent settings and MCP files, for P02 to P06 and P09's final levels (E3 item 23, policy settings).
   * Absent: those rules emit nothing and P09 keeps its warn.
   */
  settingsSources?: PolicySettingsSources;
}

export interface PolicyEvaluation {
  violations: PolicyViolation[];
  /** How many violations of a rule a cap left out; every rule id is capped at 50. */
  omitted: Partial<Record<PolicyRuleId, number>>;
  /** The rule ids a policy file asked to lower and that were not lowered; distinct, in id order. */
  lowered: PolicyRuleId[];
  /** The agent policy settings a policy file asked to lower and that were not applied. */
  ignored: IgnoredSetting[];
  /** The evidence and the incomplete reason of the detection, when one ran. */
  agentPr?: { evidence: AgentEvidence[]; incomplete: AgentPrIncomplete | null };
  /**
   * What the settings reader found. Present only when a policy is in force and the sources were given (files or
   * unavailable); absent otherwise, never written as undefined or null.
   */
  settings?: PolicySettingsOutcome;
}

/** One raw finding of a rule before the policy's rule severities are applied. */
export interface RuleFinding {
  id: PolicyRuleId;
  /** The default severity of this finding's class. */
  fallback: PolicyViolationSeverity;
  path: string | null;
  /** The 1-based line of the entry or key; null for a whole file, a missing item or no file. */
  line: number | null;
  detail: string;
}
