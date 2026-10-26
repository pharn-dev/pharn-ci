import { AGENT_TOOLS } from "../setup/summary.js";
import { TEST_INTEGRITY_MODES } from "../testIntegrityMode.js";
import { ErrorCollector, enumMessage, MESSAGES, maxCharsMessage, rangeMessage } from "./errors.js";
import { codePointLength, GRAMMARS, type Grammar } from "./grammar.js";
import {
  POLICY_MAX_CHANGED_LINES_MAX,
  POLICY_MAX_CHANGED_LINES_MIN,
  POLICY_MAX_FILES_MAX,
  POLICY_MAX_FILES_MIN,
  POLICY_MAX_LIST_ITEMS,
  POLICY_MIN_AGE_DAYS_MAX,
  POLICY_MIN_AGE_DAYS_MIN,
  POLICY_MIN_WEEKLY_DOWNLOADS_MAX,
  POLICY_MIN_WEEKLY_DOWNLOADS_MIN,
  POLICY_PROTECTED_PATHS_MODES,
  POLICY_REGISTRIES,
  POLICY_RULE_IDS,
  POLICY_SEVERITIES,
  POLICY_SIGNAL_IDS,
  POLICY_THRESHOLD_MAX,
  POLICY_THRESHOLD_MIN,
} from "./limits.js";
import type { PolicyDocument, PolicyValidation } from "./types.js";

/**
 * A handler checks one value at one path. It returns the validated value (a fresh copy for an object or a list), or
 * `undefined` when it added an error. No valid value is `undefined`; `false`, `0` and `null` are valid.
 */
type Handler = (value: unknown, path: string, errors: ErrorCollector) => unknown;

/** The handlers of an object's known keys. Looked up with a Map, never with `in` or a plain object. */
type Known = ReadonlyMap<string, Handler>;

function known(entries: ReadonlyArray<readonly [string, Handler]>): Known {
  return new Map(entries);
}

/** An object with a closed key set: unknown keys are errors and never read, copied or descended into. */
function objectOf(keys: Known, required: readonly string[] = []): Handler {
  return (value, path, errors) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.add(path, MESSAGES.object);
      return undefined;
    }
    const input = value as Record<string, unknown>;
    for (const key of required) {
      if (!Object.hasOwn(input, key)) errors.add(`${path}/${key}`, MESSAGES.required);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      const handler = keys.get(key);
      if (handler === undefined) {
        errors.addUnknownKey(path, key);
        continue;
      }
      const result = handler(input[key], `${path}/${key}`, errors);
      if (result !== undefined) out[key] = result;
    }
    return out;
  };
}

/** A list of at most 1000 items; the length is checked before any item is read. */
function listOf(item: Handler): Handler {
  return (value, path, errors) => {
    if (!Array.isArray(value)) {
      errors.add(path, MESSAGES.list);
      return undefined;
    }
    if (value.length > POLICY_MAX_LIST_ITEMS) {
      errors.add(path, MESSAGES.tooManyItems);
      return undefined;
    }
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const result = item(value[i], `${path}/${String(i)}`, errors);
      if (result !== undefined) out.push(result);
    }
    return out;
  };
}

/** One of a fixed list of strings. */
function enumOf(members: readonly string[]): Handler {
  const message = enumMessage(members);
  return (value, path, errors) => {
    if (typeof value === "string" && members.includes(value)) return value;
    errors.add(path, message);
    return undefined;
  };
}

/** A string under a grammar: its length is checked before its regex runs. */
function stringOf(grammar: Grammar): Handler {
  const tooLong = maxCharsMessage(grammar.max);
  return (value, path, errors) => {
    if (typeof value !== "string") {
      errors.add(path, MESSAGES.string);
      return undefined;
    }
    if (value === "") {
      errors.add(path, MESSAGES.empty);
      return undefined;
    }
    if (codePointLength(value, grammar.max) > grammar.max) {
      errors.add(path, tooLong);
      return undefined;
    }
    if (!grammar.regex.test(value)) {
      errors.add(path, grammar.message);
      return undefined;
    }
    return value;
  };
}

const bool: Handler = (value, path, errors) => {
  if (typeof value === "boolean") return value;
  errors.add(path, MESSAGES.boolean);
  return undefined;
};

/** A finite number in an inclusive range. */
function numberIn(min: number, max: number): Handler {
  const range = rangeMessage(min, max);
  return (value, path, errors) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.add(path, MESSAGES.number);
      return undefined;
    }
    if (value < min || value > max) {
      errors.add(path, range);
      return undefined;
    }
    return value;
  };
}

/** An integer in an inclusive range. */
function integerIn(min: number, max: number): Handler {
  const range = rangeMessage(min, max);
  return (value, path, errors) => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.add(path, MESSAGES.integer);
      return undefined;
    }
    if (value < min || value > max) {
      errors.add(path, range);
      return undefined;
    }
    return value;
  };
}

const version: Handler = (value, path, errors) => {
  if (value === 1) return 1;
  errors.add(path, MESSAGES.version);
  return undefined;
};

const severity = enumOf(POLICY_SEVERITIES);

/** `coverage.root`: `null` for none, else a ROOT string. */
const rootString = stringOf(GRAMMARS.root);
const rootOrNull: Handler = (value, path, errors) => {
  if (value === null) return null;
  if (typeof value !== "string") {
    errors.add(path, MESSAGES.stringOrNull);
    return undefined;
  }
  return rootString(value, path, errors);
};

const coverage = objectOf(
  known([
    ["threshold", numberIn(POLICY_THRESHOLD_MIN, POLICY_THRESHOLD_MAX)],
    ["exclude", listOf(stringOf(GRAMMARS.glob))],
    ["root", rootOrNull],
  ]),
);

const requiredHook = objectOf(
  known([
    ["event", stringOf(GRAMMARS.event)],
    ["matcher", stringOf(GRAMMARS.matcher)],
  ]),
  ["event"],
);

const setup = objectOf(
  known([
    ["require", bool],
    ["expect", listOf(enumOf(AGENT_TOOLS))],
    ["consistency", severity],
    ["forbidden_permissions", listOf(stringOf(GRAMMARS.perm))],
    ["required_permissions_deny", listOf(stringOf(GRAMMARS.perm))],
    ["allowed_mcp_servers", listOf(stringOf(GRAMMARS.name))],
    ["forbidden_mcp_servers", listOf(stringOf(GRAMMARS.nameOrGlob))],
    ["required_hooks", listOf(requiredHook)],
    ["forbidden_files", listOf(stringOf(GRAMMARS.glob))],
  ]),
);

const testIntegrity = objectOf(
  known([
    ["mode", enumOf(TEST_INTEGRITY_MODES)],
    ["signals", objectOf(known(POLICY_SIGNAL_IDS.map((id) => [id, severity] as const)))],
    ["accept_label", stringOf(GRAMMARS.label)],
  ]),
);

const flaky = objectOf(known([["quarantine", bool]]));

const policySettings = objectOf(
  known([
    ["required", bool],
    ["rules", objectOf(known(POLICY_RULE_IDS.map((id) => [id, severity] as const)))],
  ]),
);

const agents = objectOf(
  known([
    ["labels", listOf(stringOf(GRAMMARS.label))],
    ["extra_logins", listOf(stringOf(GRAMMARS.login))],
    ["protected_paths", listOf(stringOf(GRAMMARS.glob))],
    ["protected_paths_mode", enumOf(POLICY_PROTECTED_PATHS_MODES)],
    ["require_human_approval", bool],
    ["max_files", integerIn(POLICY_MAX_FILES_MIN, POLICY_MAX_FILES_MAX)],
    ["max_changed_lines", integerIn(POLICY_MAX_CHANGED_LINES_MIN, POLICY_MAX_CHANGED_LINES_MAX)],
  ]),
);

const dependencies = objectOf(
  known([
    ["registries", listOf(enumOf(POLICY_REGISTRIES))],
    ["min_age_days", integerIn(POLICY_MIN_AGE_DAYS_MIN, POLICY_MIN_AGE_DAYS_MAX)],
    ["min_weekly_downloads", integerIn(POLICY_MIN_WEEKLY_DOWNLOADS_MIN, POLICY_MIN_WEEKLY_DOWNLOADS_MAX)],
  ]),
);

const document = objectOf(
  known([
    ["version", version],
    ["coverage", coverage],
    ["setup", setup],
    ["test_integrity", testIntegrity],
    ["flaky", flaky],
    ["policy", policySettings],
    ["agents", agents],
    ["dependencies", dependencies],
  ]),
  ["version"],
);

/**
 * Validates a value against the policy document, version 1. Pure and total: it never throws, never repeats a value
 * from the document in an error, and walks only the schema's own shape, so its work is bounded by the input's size
 * whatever the input's depth, cycles or unknown subtrees. A valid result holds fresh objects and arrays with exactly
 * the input's keys and values: nothing is normalized and no default is filled.
 */
export function validatePolicy(value: unknown): PolicyValidation {
  try {
    const errors = new ErrorCollector();
    const out = document(value, "", errors);
    if (errors.total === 0) return { ok: true, policy: out as PolicyDocument };
    return { ok: false, errors: errors.finish() };
  } catch {
    return { ok: false, errors: [{ path: "", message: MESSAGES.couldNotValidate }] };
  }
}
