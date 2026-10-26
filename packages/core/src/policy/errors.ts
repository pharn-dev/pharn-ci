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
  couldNotValidate: "policy could not be validated",
  textNotString: "policy text must be a string",
  textNotJson: "policy text is not valid JSON",
} as const;

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

/** Counts every error, keeps the first `POLICY_MAX_ERRORS`, and reports the rest as one line. */
export class ErrorCollector {
  private readonly stored: PolicyError[] = [];
  private count = 0;

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
    this.count++;
    if (this.stored.length < POLICY_MAX_ERRORS) {
      this.stored.push({ path: `${parent}/${pointerSegment(key)}`, message: MESSAGES.unknownKey });
    }
  }

  /** All errors when there are at most `POLICY_MAX_ERRORS`; else the first 49 and a line counting the rest. */
  finish(): PolicyError[] {
    if (this.count <= POLICY_MAX_ERRORS) return this.stored.slice();
    const listed = this.stored.slice(0, POLICY_MAX_ERRORS - 1);
    listed.push({ path: "", message: `${String(this.count - (POLICY_MAX_ERRORS - 1))} more errors not listed` });
    return listed;
  }
}
