import type { MessageCode } from "../report.js";
import {
  TEST_INTEGRITY_MESSAGE_FIXES,
  TEST_INTEGRITY_SIGNAL_FIXES,
  type TestIntegritySignalId,
} from "../signals/registry.js";

/**
 * Fix hints (since 0.9.0): how to fix a message or a finding honestly. One kind from a closed list and one fixed English
 * sentence per message code and per signal id, written here (the test-integrity ones in `signals/registry.ts`), never by
 * a model and never from the code under review. No kind lowers a gate: none lowers a threshold, adds an exclusion, turns
 * a test off, adds an exemption or edits a policy. The hint is the one advice text of its code: the PR comment shows the
 * same sentence (CORE-140), with the accept-label clause at its end where the code has one.
 */

/** The closed list of kinds, in the order the schema's `$defs.fix.properties.kind.enum` lists them. */
export const FIX_KINDS = [
  "add-test",
  "restore-test",
  "restore-assertion",
  "revert-config",
  "remove-dependency",
  "request-review",
  "split-pr",
  "none",
] as const;

export type FixKind = (typeof FIX_KINDS)[number];

/** One table entry: the kind and its one fixed sentence (at most 200 characters, no placeholder). */
export interface FixEntry {
  kind: FixKind;
  hint: string;
}

/** The `fix` object of a message or a finding. `target` is the path, or `path:line`, a finding already names. */
export interface FixHint {
  kind: FixKind;
  target?: string;
  hint: string;
}

/**
 * Every signal id core produces: TI01 to TI17 (from the registry), the P ids with a rule file (there is no P12), SI01 to SI04, PI01 to PI05
 * and D01 to D05. TI15 and SI04 are not emitted since CORE-144; their entries stay because their message codes stay.
 */
export type FixSignalId =
  | TestIntegritySignalId
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
  | "P13"
  | "P14"
  | "SI01"
  | "SI02"
  | "SI03"
  | "SI04"
  | "PI01"
  | "PI02"
  | "PI03"
  | "PI04"
  | "PI05"
  | "D01"
  | "D02"
  | "D03"
  | "D04"
  | "D05";

const REVIEW_POLICY = "Ask a maintainer or the policy owner to review the committed agent settings this rule names.";
const REVIEW_INJECTION = "Ask a reviewer to look at the added text that addresses an AI agent before merging.";

/** The kind and hint of each signal id. */
export const SIGNAL_FIXES: Readonly<Record<FixSignalId, FixEntry>> = {
  ...TEST_INTEGRITY_SIGNAL_FIXES,
  P01: { kind: "none", hint: "A maintainer should add the agent setup files the org policy requires." },
  P02: { kind: "request-review", hint: REVIEW_POLICY },
  P03: { kind: "request-review", hint: REVIEW_POLICY },
  P04: { kind: "request-review", hint: REVIEW_POLICY },
  P05: { kind: "request-review", hint: REVIEW_POLICY },
  P06: { kind: "request-review", hint: REVIEW_POLICY },
  P07: {
    kind: "none",
    hint: "A maintainer should make the agent instruction files agree on one package manager and one test runner.",
  },
  P08: {
    kind: "request-review",
    hint: "Ask a maintainer to review the tracked files that match the org policy's forbidden patterns.",
  },
  P09: { kind: "revert-config", hint: "Revert the edit to the file the org policy guards." },
  P10: { kind: "none", hint: "The org policy could not be used; a maintainer should check where it comes from." },
  P11: {
    kind: "request-review",
    hint: "Ask a person to review or make the change to the paths the org policy protects from agent pull requests.",
  },
  P13: { kind: "revert-config", hint: "Revert the edit that widens what an agent may do." },
  P14: { kind: "split-pr", hint: "Split the change into smaller pull requests within the org policy's size caps." },
  SI01: { kind: "none", hint: "Update this agent instruction so it names a script, path or file that exists." },
  SI02: { kind: "none", hint: "Update this agent instruction so it names a script, path or file that exists." },
  SI03: { kind: "none", hint: "Update this agent instruction so it names a script, path or file that exists." },
  SI04: {
    kind: "none",
    hint: "Check that this old agent instruction file still describes the file this change edits.",
  },
  PI01: {
    kind: "request-review",
    hint: "Ask a reviewer to look at the invisible characters this change adds before merging.",
  },
  PI02: { kind: "request-review", hint: REVIEW_INJECTION },
  PI03: { kind: "request-review", hint: REVIEW_INJECTION },
  PI04: {
    kind: "request-review",
    hint: "Ask a reviewer to look at the long encoded run added to an agent instruction file before merging.",
  },
  PI05: {
    kind: "request-review",
    hint: "Ask a reviewer to look at the agent instruction file added inside vendored code before merging.",
  },
  D01: { kind: "remove-dependency", hint: "Remove the dependency; the package does not exist in the registry." },
  D02: {
    kind: "remove-dependency",
    hint: "Remove the newly published package, or wait until it is older and pin a reviewed version.",
  },
  D03: {
    kind: "remove-dependency",
    hint: "Remove the rarely downloaded package, or have a reviewer vet it first.",
  },
  D04: {
    kind: "request-review",
    hint: "Regenerate the lockfile with the package manager and ask a reviewer to confirm the manifest change was meant.",
  },
  D05: {
    kind: "remove-dependency",
    hint: "Depend on a published registry version, or name the host of a registry your team runs in the dependency-allowed-hosts input; otherwise remove the dependency.",
  },
};

const S = SIGNAL_FIXES;

const REVIEW_SECRET: FixEntry = {
  kind: "request-review",
  hint: "Ask a maintainer to remove the value from the committed agent config, rotate it and load it from the environment.",
};

/** The kind and hint of each message code; a signal-family code points at its signal's entry. */
export const MESSAGE_FIXES: Readonly<Record<MessageCode, FixEntry>> = {
  DIFF_COVERAGE_BELOW_THRESHOLD: {
    kind: "add-test",
    hint: "Add tests that run the changed lines listed in the report.",
  },
  DIFF_COVERAGE_UNGATED: {
    kind: "none",
    hint: "Check whether the diff coverage gate should be turned on for this repository.",
  },
  NO_COVERABLE_CHANGES: {
    kind: "none",
    hint: "Check that the coverage report tracks the source files this change edits.",
  },
  COVERAGE_FILE_MISSING: {
    kind: "none",
    hint: "Check that the test step writes the coverage file where the check reads it.",
  },
  COVERAGE_FILE_EMPTY: {
    kind: "none",
    hint: "Check that the tests ran and wrote records to the coverage file.",
  },
  COVERAGE_FORMAT_UNSUPPORTED: {
    kind: "none",
    hint: "Check that the coverage file is in lcov or Cobertura XML format.",
  },
  DIFF_UNAVAILABLE: {
    kind: "none",
    hint: "Check that the workflow fetches the base commit so the diff can be read.",
  },
  COVERAGE_PATHS_UNMATCHED: {
    kind: "none",
    hint: "Check that the coverage paths start at the repository root, or set the coverage root.",
  },
  COVERAGE_PATHS_PARTIALLY_UNMATCHED: {
    kind: "none",
    hint: "Check that the coverage paths start at the repository root so every file is matched.",
  },
  COVERAGE_LINES_SKIPPED: {
    kind: "none",
    hint: "Check that the coverage reporter finished writing the file.",
  },
  CONFIG_CHANGED_IN_DIFF: {
    kind: "request-review",
    hint: "Ask a reviewer to confirm that the change to the files that configure this check is meant.",
  },
  COVERAGE_FILE_TRACKED: {
    kind: "request-review",
    hint: "Ask a maintainer to stop tracking the coverage file, so a change cannot supply its own numbers.",
  },
  DIFF_BINARY_COVERED_FILE: {
    kind: "none",
    hint: "Check .gitattributes so source files are not marked binary or -diff.",
  },
  TEST_FILES_DELETED: {
    kind: "restore-test",
    hint: "Restore the deleted test files, or move their tests to files that still run them.",
  },
  NO_AGENT_SETUP_FILES: {
    kind: "none",
    hint: "Check whether the repository should have an agent instruction file such as AGENTS.md.",
  },
  AGENT_SETUP_FILE_EMPTY: {
    kind: "none",
    hint: "Check why the agent setup file is empty and add its instructions.",
  },
  AGENT_SETUP_EXPECTED_MISSING: {
    kind: "none",
    hint: "Check which agent tools the repository expects and add their setup files.",
  },
  TEST_INTEGRITY_MODE_IGNORED: {
    kind: "none",
    hint: "Check the test integrity mode in the config; a config can only make the check stricter.",
  },
  TEST_INTEGRITY_OFF: { kind: "none", hint: "Check why test integrity is off for this run." },
  ...TEST_INTEGRITY_MESSAGE_FIXES,
  TEST_INTEGRITY_INDEX_UNAVAILABLE: {
    kind: "none",
    hint: "Check that the touched test files can be read, so removed tests and assertions are compared; a -diff or binary attribute in .gitattributes, or a NUL byte in the file, can cause this.",
  },
  TEST_INTEGRITY_TEXT_TRUNCATED: {
    kind: "none",
    hint: "Check the changed test lines past the cut by hand, or split the change into smaller pull requests.",
  },
  TEST_INTEGRITY_ACCEPTED: {
    kind: "none",
    hint: "Check that the sign-off covers the findings listed in the report, and remove the label if a later push should be judged again.",
  },
  TEST_INTEGRITY_ACCEPT_IGNORED: {
    kind: "none",
    hint: "Check that a reviewer who is not the author applies the accept label.",
  },
  AGENT_CONFIG_SECRET_S01: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S02: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S03: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S04: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S05: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S06: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S07: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S08: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S09: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S10: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_S11: REVIEW_SECRET,
  AGENT_CONFIG_SECRET_UNSCANNED: {
    kind: "none",
    hint: "Check the agent config files that could not be scanned for committed secrets.",
  },
  POLICY_UNAVAILABLE: {
    kind: "none",
    hint: "Check that the workflow grants id-token write and that the org policy can be fetched.",
  },
  POLICY_OVERRIDE_IGNORED: {
    kind: "none",
    hint: "Check that the workflow inputs and the config only make the org policy stricter.",
  },
  UPLOAD_TOO_LARGE: { kind: "none", hint: "Check the size of the report; the check itself ran in full." },
  POLICY_P08: S.P08,
  POLICY_P09: S.P09,
  POLICY_P11: S.P11,
  AGENT_PR_DETECTION_INCOMPLETE: {
    kind: "none",
    hint: "Check that the token can read the pull request, its labels and its commits.",
  },
  POLICY_P02: S.P02,
  POLICY_P03: S.P03,
  POLICY_P04: S.P04,
  POLICY_P05: S.P05,
  POLICY_P06: S.P06,
  POLICY_SETTINGS_INVALID: {
    kind: "none",
    hint: "Check the policy settings and correct the ones the report names.",
  },
  POLICY_P07: S.P07,
  POLICY_P13: S.P13,
  POLICY_P14: S.P14,
  TESTS_NOT_EXERCISING_CHANGES: {
    kind: "add-test",
    hint: "Add or change tests that import and assert on the changed source files.",
  },
  SETUP_STALE_SI01: S.SI01,
  SETUP_STALE_SI02: S.SI02,
  SETUP_STALE_SI03: S.SI03,
  SETUP_STALE_SI04: S.SI04,
  INJECTION_PI01: S.PI01,
  INJECTION_PI02: S.PI02,
  INJECTION_PI03: S.PI03,
  INJECTION_PI04: S.PI04,
  INJECTION_PI05: S.PI05,
  INJECTION_TEXT_TRUNCATED: {
    kind: "none",
    hint: "Check the long added text by hand, or split the change into smaller pull requests.",
  },
  JUNIT_NOT_FOUND: {
    kind: "none",
    hint: "Check that the test step writes the JUnit XML file where the junit paths point.",
  },
  JUNIT_INVALID: { kind: "none", hint: "Check that the JUnit XML file is well formed and complete." },
  JUNIT_TOO_LARGE: { kind: "none", hint: "Check the size of the JUnit XML file; it is too large to be read." },
  FLAKY_QUARANTINED_FAILURES: {
    kind: "none",
    hint: "Check the quarantined tests that failed and whether they are still flaky.",
  },
  DEPENDENCY_D01: S.D01,
  DEPENDENCY_D02: S.D02,
  DEPENDENCY_D03: S.D03,
  DEPENDENCY_D04: S.D04,
  DEPENDENCY_D05: S.D05,
  DEPENDENCY_LOOKUP_UNAVAILABLE: {
    kind: "none",
    hint: "Check that the runner can reach the package registries, then run the check again.",
  },
  DEPENDENCY_CHECK_INCOMPLETE: {
    kind: "none",
    hint: "Check that the manifest or lockfile the report names can be read and parsed, and keep it under 32 MiB.",
  },
  POLICY_KEYS_UNKNOWN: {
    kind: "none",
    hint: "Update the pharn-ci pin in the workflow to a release that knows the org policy's newer keys.",
  },
};
