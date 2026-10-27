import type { TestSourceDropReason, TestSourceFile } from "../../testSources.js";

/** A settings or MCP file that was not read, and why (E3 item 23, policy settings). */
export interface PolicySettingsDrop {
  path: string;
  reason: TestSourceDropReason | "symlink";
}

/**
 * The committed agent settings and MCP files for policy mode: why they could not be read, or the files kept and the
 * files dropped.
 */
export type PolicySettingsSources =
  | { unavailable: string }
  | { files: TestSourceFile[]; dropped: PolicySettingsDrop[] };

export type SettingsProblemReason =
  | "too-large"
  | "over-file-cap"
  | "over-total-cap"
  | "unsafe-path"
  | "symlink"
  | "binary"
  | "not-json"
  | "not-object"
  | "too-deep"
  | "unknown-rule-syntax"
  | "wrong-type"
  | "duplicate-key"
  | "compare-budget";

/** A reason a rule could not fully use a file; never carries file text. */
export interface SettingsProblem {
  path: string | null;
  line: number | null;
  reason: SettingsProblemReason;
}

export interface PolicySettingsProblem extends SettingsProblem {
  level: "error" | "warn";
}

/** What the settings reader found: the sources were unavailable, or the problems that stopped a rule fully using a file. */
export interface PolicySettingsOutcome {
  unavailable: { reason: string; level: "warn" | "error" } | null;
  problems: PolicySettingsProblem[];
}
