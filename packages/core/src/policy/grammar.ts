import { MESSAGES } from "./errors.js";
import {
  POLICY_MAX_EVENT,
  POLICY_MAX_GLOB,
  POLICY_MAX_LABEL,
  POLICY_MAX_LOGIN,
  POLICY_MAX_MATCHER,
  POLICY_MAX_NAME,
  POLICY_MAX_NAME_OR_GLOB,
  POLICY_MAX_PERM,
  POLICY_MAX_ROOT,
} from "./limits.js";

/**
 * The regex sources of the string grammars, each written once. `schema/policy.v1.json` carries the same sources
 * JSON-escaped in its `pattern` values, and a test pins the two equal. Each is compiled with the `u` flag, which is
 * what Ajv uses, so both engines run the same regex. Never add `g` or `y`: they make `test` stateful.
 */
export const POLICY_PATTERNS = {
  /** No control character; no leading or trailing white space (ECMAScript `\s`). */
  PLAIN: String.raw`^(?!\s)(?![\s\S]*\s$)[^\u0000-\u001F\u007F]*$`,
  /** A glob: not starting with `./`, `/` or `!`; not ending with `/`; no `//`; no `..` segment; none of `\{}[]`. */
  GLOB: String.raw`^(?!\s)(?![\s\S]*\s$)(?!\./)(?![/!])(?![\s\S]*/$)(?![\s\S]*//)(?!(?:[\s\S]*/)?\.\.(?:/|$))[^\u0000-\u001F\u007F\\{}\[\]]*$`,
  /** A normalized repo-relative directory. */
  ROOT: String.raw`^(?!\s)(?![\s\S]*\s$)(?![/-])(?![A-Za-z]:)(?!\./)(?![\s\S]*/$)(?![\s\S]*//)(?!(?:[\s\S]*/)?\.\.(?:/|$))[^\u0000-\u001F\u007F\\]*$`,
  /** `Tool` or `Tool(pattern)`. */
  PERM: String.raw`^(?![\s\S]*[\u0000-\u001F\u007F])[A-Za-z][A-Za-z0-9_-]*(\(.+\))?$`,
  /** A GitHub login, optionally followed by `[bot]`. */
  LOGIN: String.raw`^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$`,
  /** A hook event name. */
  EVENT: "^[A-Za-z]+$",
} as const;

const PLAIN = new RegExp(POLICY_PATTERNS.PLAIN, "u");
const GLOB = new RegExp(POLICY_PATTERNS.GLOB, "u");
const ROOT = new RegExp(POLICY_PATTERNS.ROOT, "u");
const PERM = new RegExp(POLICY_PATTERNS.PERM, "u");
const LOGIN = new RegExp(POLICY_PATTERNS.LOGIN, "u");
const EVENT = new RegExp(POLICY_PATTERNS.EVENT, "u");

/** A string grammar: its longest length in code points, its regex and the message when the regex fails. */
export interface Grammar {
  readonly max: number;
  readonly regex: RegExp;
  readonly message: string;
}

export const GRAMMARS = {
  glob: { max: POLICY_MAX_GLOB, regex: GLOB, message: MESSAGES.glob },
  root: { max: POLICY_MAX_ROOT, regex: ROOT, message: MESSAGES.root },
  perm: { max: POLICY_MAX_PERM, regex: PERM, message: MESSAGES.perm },
  name: { max: POLICY_MAX_NAME, regex: PLAIN, message: MESSAGES.plain },
  nameOrGlob: { max: POLICY_MAX_NAME_OR_GLOB, regex: PLAIN, message: MESSAGES.plain },
  label: { max: POLICY_MAX_LABEL, regex: PLAIN, message: MESSAGES.plain },
  login: { max: POLICY_MAX_LOGIN, regex: LOGIN, message: MESSAGES.login },
  event: { max: POLICY_MAX_EVENT, regex: EVENT, message: MESSAGES.event },
  matcher: { max: POLICY_MAX_MATCHER, regex: PLAIN, message: MESSAGES.plain },
} as const satisfies Record<string, Grammar>;

/**
 * The length of `s` in Unicode code points, as Ajv counts it (a surrogate pair is one, a lone surrogate is one),
 * capped: a result above `max` only means "over `max`". A string of at most `max` units is within `max`; one of
 * more than `2 * max` units is over; only the strings between are counted, and counting stops past `max`.
 */
export function codePointLength(s: string, max: number): number {
  if (s.length <= max) return s.length;
  if (s.length > 2 * max) return max + 1;
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    count++;
    if (count > max) return count;
    const unit = s.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
  }
  return count;
}
