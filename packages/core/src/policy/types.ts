import type { TestIntegrityMode } from "../report.js";
import type { AgentTool } from "../setup/summary.js";

/** How hard a finding bites: `block` fails the check, `off` switches it off. */
export type PolicySeverity = "block" | "warn" | "info" | "off";

/** A test-integrity signal id. */
export type PolicySignalId =
  | "TI01"
  | "TI02"
  | "TI03"
  | "TI04"
  | "TI05"
  | "TI06"
  | "TI07"
  | "TI08"
  | "TI09"
  | "TI10"
  | "TI11"
  | "TI12"
  | "TI13"
  | "TI14"
  | "TI15"
  | "TI16";

/** A policy rule id. */
export type PolicyRuleId =
  | "P01"
  | "P02"
  | "P03"
  | "P04"
  | "P05"
  | "P06"
  | "P07"
  | "P08"
  | "P09"
  | "P10"
  | "P11"
  | "P12"
  | "P13"
  | "P14";

export type PolicyRegistry = "npm" | "pypi";
export type PolicyProtectedPathsMode = "block" | "warn";

export interface PolicyCoverage {
  threshold?: number;
  exclude?: string[];
  root?: string | null;
}

export interface PolicyRequiredHook {
  event: string;
  matcher?: string;
}

export interface PolicySetup {
  require?: boolean;
  expect?: AgentTool[];
  consistency?: PolicySeverity;
  forbidden_permissions?: string[];
  required_permissions_deny?: string[];
  allowed_mcp_servers?: string[];
  forbidden_mcp_servers?: string[];
  required_hooks?: PolicyRequiredHook[];
  forbidden_files?: string[];
}

export interface PolicyTestIntegrity {
  mode?: TestIntegrityMode;
  signals?: Partial<Record<PolicySignalId, PolicySeverity>>;
  accept_label?: string;
}

export interface PolicyFlaky {
  quarantine?: boolean;
}

/** The `policy` key of the document. */
export interface PolicySettings {
  required?: boolean;
  rules?: Partial<Record<PolicyRuleId, PolicySeverity>>;
}

export interface PolicyAgents {
  labels?: string[];
  extra_logins?: string[];
  protected_paths?: string[];
  protected_paths_mode?: PolicyProtectedPathsMode;
  require_human_approval?: boolean;
  max_files?: number;
  max_changed_lines?: number;
}

export interface PolicyDependencies {
  registries?: PolicyRegistry[];
  min_age_days?: number;
  min_weekly_downloads?: number;
}

/** A validated policy document, version 1: exactly the keys and values of the input, in fresh objects. */
export interface PolicyDocument {
  version: 1;
  coverage?: PolicyCoverage;
  setup?: PolicySetup;
  test_integrity?: PolicyTestIntegrity;
  flaky?: PolicyFlaky;
  policy?: PolicySettings;
  agents?: PolicyAgents;
  dependencies?: PolicyDependencies;
}

/** One problem: an RFC 6901 JSON Pointer and a fixed message that never repeats a value from the document. */
export interface PolicyError {
  path: string;
  message: string;
}

export type PolicyValidation = { ok: true; policy: PolicyDocument } | { ok: false; errors: PolicyError[] };
