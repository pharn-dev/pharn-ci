import { byCodeUnit, cutCodeUnits } from "../text.js";
import { POLICY_MAX_ERRORS } from "./limits.js";
import type { PolicyError } from "./types.js";

/**
 * The fixed message texts. No message ever holds anything from the document: the document is untrusted, so a
 * value (a secret, hostile text) never reaches an error, a report or a log. A path may hold an unknown key, cut
 * and cleaned by `pointerSegment`.
 */
export const MESSAGES = {
  object: "must be an object",
  required: "is required",
  unknownKey: "is not a known key",
  list: "must be a list",
  tooManyItems: "must have at most 1000 items",
  string: "must be a string",
  empty: "must not be empty",
  version: "must be 1",
  number: "must be a number",
  integer: "must be an integer",
  boolean: "must be true or false",
  stringOrNull: "must be a string or null",
  plain: "must not contain a control character or start or end with white space",
  glob: "is not a supported glob pattern",
  root: "is not a repo-relative directory",
  perm: "is not a permission rule such as Tool or Tool(pattern)",
  login: "is not a GitHub login",
  event: "must contain only the letters A-Z and a-z",
  host: "is not a host name: use only the letters A-Z and a-z, digits, . and -, with no scheme, path, port, user name or wildcard",
  textNotString: "policy text must be a string",
  textNotJson: "policy text is not valid JSON",
} as const;

/** `must have at most <max> items`, for a list with a cap below the general 1000. */
export function maxItemsMessage(max: number): string {
  return `must have at most ${String(max)} items`;
}

/** `must be at most <max> characters`. */
export function maxCharsMessage(max: number): string {
  return `must be at most ${String(max)} characters`;
}

/** `must be between <min> and <max>`. */
export function rangeMessage(min: number, max: number): string {
  return `must be between ${String(min)} and ${String(max)}`;
}

/** `must be one of: a, b, c`. */
export function enumMessage(members: readonly string[]): string {
  return `must be one of: ${members.join(", ")}`;
}

/** `policy text must be at most <n> characters`. */
export function textTooLongMessage(max: number): string {
  return `policy text must be at most ${String(max)} characters`;
}

const MAX_SEGMENT_CODE_POINTS = 64;

/**
 * An unknown key as a JSON Pointer segment: control characters become `?`, a key over 64 code points is cut to its
 * first 64 plus `…` (the walk stops at the 65th, so a huge key costs O(64)), then `~` becomes `~0` and `/` `~1`.
 */
export function pointerSegment(key: string): string {
  let kept = "";
  let count = 0;
  let cut = false;
  for (const ch of key) {
    if (count === MAX_SEGMENT_CODE_POINTS) {
      cut = true;
      break;
    }
    const code = ch.charCodeAt(0);
    kept += ch.length === 1 && (code <= 0x1f || code === 0x7f) ? "?" : ch;
    count++;
  }
  if (cut) kept += "…";
  return kept.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** The longest unknown name `unknownName` keeps, in UTF-16 code units, `…` included. */
export const UNKNOWN_NAME_MAX_UNITS = 64;

/** The most unknown names a validation keeps; the rest are counted. */
export const UNKNOWN_NAMES_KEPT = 20;

/** The unknown keys and ids a served policy carried and this build skipped: the first names in order, and the count. */
export interface UnknownNames {
  /** At most `UNKNOWN_NAMES_KEPT` names, unique, sorted by code unit, each at most 64 code units. */
  names: string[];
  /** How many unique names there were in all (at least `names.length`). */
  total: number;
}

/**
 * The dotted name of an unknown key under the JSON Pointer `parent`, as the policy docs name settings: `/a/b` and `x`
 * give `a.b.x`, and a list index gives `[]` (`/setup/required_hooks/0` and `command` give
 * `setup.required_hooks[].command`). `parent` holds only known keys and indexes (an unknown key is never descended
 * into), so only `key` comes from the input. The name is cut to 64 code units (`…` included), never inside a surrogate
 * pair; its characters are kept as they are and made safe where a message quotes it (`codeSpan`).
 */
export function unknownName(parent: string, key: string): string {
  const head = dottedPath(parent);
  // The key alone is cut first (one unit past the limit, so a cut still shows `…`): a huge key costs one slice.
  const shortKey = cutCodeUnits(key, UNKNOWN_NAME_MAX_UNITS + 1, { marker: false });
  return cutCodeUnits(head === "" ? shortKey : `${head}.${shortKey}`, UNKNOWN_NAME_MAX_UNITS);
}

/**
 * The name of an unknown value in a list (a tool of `setup.expect` this build does not know) at the JSON Pointer `path`
 * of the item: the list's dotted path and the value in brackets, `setup.expect[new-tool]`, cut like `unknownName`.
 */
export function unknownItemName(path: string, value: string): string {
  const list = dottedPath(path.slice(0, path.lastIndexOf("/")));
  const shortValue = cutCodeUnits(value, UNKNOWN_NAME_MAX_UNITS + 1, { marker: false });
  return cutCodeUnits(`${list}[${shortValue}]`, UNKNOWN_NAME_MAX_UNITS);
}

/** A JSON Pointer of known keys and indexes as a dotted path: `/a/0/b` is `a[].b`, `` is ``. */
function dottedPath(pointer: string): string {
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => (/^\d+$/.test(segment) ? "[]" : `.${segment}`))
    .join("")
    .replace(/^\./, "");
}

/**
 * Counts every error, keeps the first `POLICY_MAX_ERRORS`, and reports the rest as one line. With `skipUnknown` (a policy
 * the app serves), an unknown key or id is not an error: its name is kept apart (`unknown()`), so the rest of the
 * document still applies. Without it (a `file:` policy, the CLI's `--policy-file`), every unknown key is an error.
 */
export class ErrorCollector {
  private readonly stored: PolicyError[] = [];
  private count = 0;
  private readonly skipped = new Set<string>();

  constructor(readonly skipUnknown = false) {}

  /** The number of errors added so far. */
  get total(): number {
    return this.count;
  }

  add(path: string, message: string): void {
    this.count++;
    if (this.stored.length < POLICY_MAX_ERRORS) this.stored.push({ path, message });
  }

  /** An unknown key under `parent`; the key's segment is built only when the error is kept. */
  addUnknownKey(parent: string, key: string): void {
    if (this.skipUnknown) {
      this.skipped.add(unknownName(parent, key));
      return;
    }
    this.count++;
    if (this.stored.length < POLICY_MAX_ERRORS) {
      this.stored.push({ path: `${parent}/${pointerSegment(key)}`, message: MESSAGES.unknownKey });
    }
  }

  /** A value this build does not know, by its name (`unknownItemName`); called only with `skipUnknown`. */
  addUnknownName(name: string): void {
    this.skipped.add(cutCodeUnits(name, UNKNOWN_NAME_MAX_UNITS));
  }

  /** The unknown names skipped: the first `UNKNOWN_NAMES_KEPT` in code-unit order, and the count. */
  unknown(): UnknownNames {
    const sorted = [...this.skipped].sort(byCodeUnit);
    return { names: sorted.slice(0, UNKNOWN_NAMES_KEPT), total: sorted.length };
  }

  /** All errors when there are at most `POLICY_MAX_ERRORS`; else the first 49 and a line counting the rest. */
  finish(): PolicyError[] {
    if (this.count <= POLICY_MAX_ERRORS) return this.stored.slice();
    const listed = this.stored.slice(0, POLICY_MAX_ERRORS - 1);
    listed.push({ path: "", message: `${String(this.count - (POLICY_MAX_ERRORS - 1))} more errors not listed` });
    return listed;
  }
}
