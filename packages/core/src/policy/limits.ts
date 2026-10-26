import type {
  PolicyProtectedPathsMode,
  PolicyRegistry,
  PolicyRuleId,
  PolicySeverity,
  PolicySignalId,
} from "./types.js";

/** The longest policy text `parsePolicyJson` reads, in UTF-16 code units, checked before `JSON.parse`. */
export const POLICY_MAX_CHARS = 262144;

/** The most errors a validation returns; a longer list ends with one "N more errors not listed" entry. */
export const POLICY_MAX_ERRORS = 50;

/** The most items any list may hold. */
export const POLICY_MAX_LIST_ITEMS = 1000;

/** Longest strings, in Unicode code points, per grammar. */
export const POLICY_MAX_GLOB = 512;
export const POLICY_MAX_ROOT = 512;
export const POLICY_MAX_PERM = 512;
export const POLICY_MAX_NAME = 128;
export const POLICY_MAX_NAME_OR_GLOB = 512;
export const POLICY_MAX_LABEL = 50;
export const POLICY_MAX_LOGIN = 44;
export const POLICY_MAX_EVENT = 64;
export const POLICY_MAX_MATCHER = 512;

/** Numeric ranges, inclusive. */
export const POLICY_THRESHOLD_MIN = 0;
export const POLICY_THRESHOLD_MAX = 100;
export const POLICY_MAX_FILES_MIN = 1;
export const POLICY_MAX_FILES_MAX = 100000;
export const POLICY_MAX_CHANGED_LINES_MIN = 1;
export const POLICY_MAX_CHANGED_LINES_MAX = 10000000;
export const POLICY_MIN_AGE_DAYS_MIN = 0;
export const POLICY_MIN_AGE_DAYS_MAX = 3650;
export const POLICY_MIN_WEEKLY_DOWNLOADS_MIN = 0;
export const POLICY_MIN_WEEKLY_DOWNLOADS_MAX = 1000000000;

/** The severities, strictest first. */
export const POLICY_SEVERITIES = ["block", "warn", "info", "off"] as const satisfies readonly PolicySeverity[];

/** The signal ids a `test_integrity.signals` map may name. */
export const POLICY_SIGNAL_IDS = [
  "TI01",
  "TI02",
  "TI03",
  "TI04",
  "TI05",
  "TI06",
  "TI07",
  "TI08",
  "TI09",
  "TI10",
  "TI11",
  "TI12",
  "TI13",
  "TI14",
  "TI15",
  "TI16",
] as const satisfies readonly PolicySignalId[];

/** The rule ids a `policy.rules` map may name. */
export const POLICY_RULE_IDS = [
  "P01",
  "P02",
  "P03",
  "P04",
  "P05",
  "P06",
  "P07",
  "P08",
  "P09",
  "P10",
  "P11",
  "P12",
  "P13",
  "P14",
] as const satisfies readonly PolicyRuleId[];

export const POLICY_REGISTRIES = ["npm", "pypi"] as const satisfies readonly PolicyRegistry[];

export const POLICY_PROTECTED_PATHS_MODES = ["block", "warn"] as const satisfies readonly PolicyProtectedPathsMode[];
