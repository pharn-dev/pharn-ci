import { ErrorCollector, MESSAGES, maxCharsMessage, rangeMessage, type UnknownNames } from "./errors.js";
import type { PolicyDocument, PolicyError } from "./types.js";
import { validatePolicyInto } from "./validate.js";

/** The most items `quarantine` may hold. */
export const RESPONSE_MAX_QUARANTINE_ITEMS = 10_000;
/** The longest quarantine item, in UTF-16 code units. */
export const QUARANTINE_ITEM_MAX_UNITS = 1024;
const MAX_ITEM_UNITS = QUARANTINE_ITEM_MAX_UNITS;
/** The longest etag, in UTF-16 code units. */
const MAX_ETAG_UNITS = 200;
/** The range `settings.messageMaxBytes` may take, inclusive. */
const MESSAGE_MAX_BYTES_MIN = 256;
const MESSAGE_MAX_BYTES_MAX = 65_536;

/** The `settings` key of the envelope. */
export interface PolicyResponseSettings {
  uploadJunit: boolean;
  redactMessages: boolean;
  messageMaxBytes: number;
}

/** The envelope `GET /api/v1/policy` answers with: exactly these six keys. */
export interface PolicyResponse {
  version: number;
  etag: string;
  updatedAt: string;
  policy: PolicyDocument;
  quarantine: string[];
  settings: PolicyResponseSettings;
}

/**
 * A valid envelope, and the unknown keys and ids it carried: a newer app may serve keys this build does not know, and
 * they are left out (with the rest applied) instead of voiding the policy. `unknown.total` is 0 when there were none.
 */
export type PolicyResponseValidation =
  | { ok: true; response: PolicyResponse; unknown: UnknownNames }
  | { ok: false; errors: PolicyError[] };

const MESSAGE_TEXT = {
  versionMin: "must be an integer of at least 1",
  etag: "must be 1 to 200 printable ASCII characters",
  updatedAt: "must be an RFC 3339 time such as 2026-01-31T09:30:00Z or 2026-01-31T09:30:00+00:00",
  quarantineItem: "must not contain a control character",
  quarantineTooMany: "must have at most 10000 items",
} as const;

/** RFC 3339 `date-time` with an upper-case `T`, and `Z` or a numeric offset (`+00:00`, `-05:30`). */
const UPDATED_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function validUpdatedAt(value: string): boolean {
  const m = UPDATED_AT.exec(value);
  if (m === null) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  // A numeric offset is at most 23:59 either way (RFC 3339 `time-numoffset`).
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
  return day >= 1 && day <= days;
}

/** True when the text holds a C0 or C1 control character, DEL, or a Unicode line or paragraph separator. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/** True when every character is printable ASCII (space to tilde). */
function isPrintableAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Validates the envelope the app serves. Six keys, every one required: `version` (an integer of at least 1), `etag`,
 * `updatedAt` (an RFC 3339 time, `Z` or a numeric offset), `policy` (a policy document, walked as `validatePolicy` walks
 * it), `quarantine` (at most 10,000 items of 1 to 1,024 code units without a control character) and `settings`. Every
 * problem is one RFC 6901 pointer and a fixed message that never repeats a value; a policy problem is under `/policy`.
 * At most `POLICY_MAX_ERRORS` problems are kept. A known key with a bad value voids the whole response, which is never
 * used in part. A key or id this build does not know (in the envelope, in `settings` or anywhere in the policy) and a
 * tool `setup.expect` names that this build does not know are not problems: they are left out, never read, copied or
 * descended into, and named in `unknown` (the app is newer than the pinned build; CORE-118). Success returns fresh
 * copies.
 */
export function validatePolicyResponse(value: unknown): PolicyResponseValidation {
  const errors = new ErrorCollector(true);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.add("", MESSAGES.object);
    return { ok: false, errors: errors.finish() };
  }
  const input = value as Record<string, unknown>;
  const keys = ["version", "etag", "updatedAt", "policy", "quarantine", "settings"] as const;
  for (const key of keys) {
    if (!Object.hasOwn(input, key)) errors.add(`/${key}`, MESSAGES.required);
  }
  for (const key of Object.keys(input)) {
    if (!(keys as readonly string[]).includes(key)) errors.addUnknownKey("", key);
  }

  let version: number | undefined;
  if (Object.hasOwn(input, "version")) {
    const v = input.version;
    if (typeof v !== "number") errors.add("/version", MESSAGES.number);
    else if (!Number.isSafeInteger(v) || v < 1) errors.add("/version", MESSAGE_TEXT.versionMin);
    else version = v;
  }

  let etag: string | undefined;
  if (Object.hasOwn(input, "etag")) {
    const v = input.etag;
    if (typeof v !== "string") errors.add("/etag", MESSAGES.string);
    else if (v === "") errors.add("/etag", MESSAGES.empty);
    else if (v.length > MAX_ETAG_UNITS) errors.add("/etag", maxCharsMessage(MAX_ETAG_UNITS));
    else if (!isPrintableAscii(v)) errors.add("/etag", MESSAGE_TEXT.etag);
    else etag = v;
  }

  let updatedAt: string | undefined;
  if (Object.hasOwn(input, "updatedAt")) {
    const v = input.updatedAt;
    if (typeof v !== "string") errors.add("/updatedAt", MESSAGES.string);
    else if (!validUpdatedAt(v)) errors.add("/updatedAt", MESSAGE_TEXT.updatedAt);
    else updatedAt = v;
  }

  let policy: PolicyDocument | undefined;
  if (Object.hasOwn(input, "policy")) {
    const before = errors.total;
    const checked = validatePolicyInto(input.policy, errors, "/policy");
    if (errors.total === before) policy = checked;
  }

  let quarantine: string[] | undefined;
  if (Object.hasOwn(input, "quarantine")) {
    const v = input.quarantine;
    if (!Array.isArray(v)) errors.add("/quarantine", MESSAGES.list);
    else if (v.length > RESPONSE_MAX_QUARANTINE_ITEMS) errors.add("/quarantine", MESSAGE_TEXT.quarantineTooMany);
    else {
      const items: string[] = [];
      let good = true;
      for (let i = 0; i < v.length; i++) {
        const item: unknown = v[i];
        const at = `/quarantine/${String(i)}`;
        if (typeof item !== "string") errors.add(at, MESSAGES.string);
        else if (item === "") errors.add(at, MESSAGES.empty);
        else if (item.length > MAX_ITEM_UNITS) errors.add(at, maxCharsMessage(MAX_ITEM_UNITS));
        else if (hasControl(item)) errors.add(at, MESSAGE_TEXT.quarantineItem);
        else {
          items.push(item);
          continue;
        }
        good = false;
      }
      if (good) quarantine = items;
    }
  }

  let settings: PolicyResponseSettings | undefined;
  if (Object.hasOwn(input, "settings")) {
    const v = input.settings;
    if (typeof v !== "object" || v === null || Array.isArray(v)) errors.add("/settings", MESSAGES.object);
    else {
      const s = v as Record<string, unknown>;
      const known = ["uploadJunit", "redactMessages", "messageMaxBytes"];
      for (const key of known) {
        if (!Object.hasOwn(s, key)) errors.add(`/settings/${key}`, MESSAGES.required);
      }
      for (const key of Object.keys(s)) {
        if (!known.includes(key)) errors.addUnknownKey("/settings", key);
      }
      let uploadJunit: boolean | undefined;
      let redactMessages: boolean | undefined;
      let messageMaxBytes: number | undefined;
      if (Object.hasOwn(s, "uploadJunit")) {
        if (typeof s.uploadJunit === "boolean") uploadJunit = s.uploadJunit;
        else errors.add("/settings/uploadJunit", MESSAGES.boolean);
      }
      if (Object.hasOwn(s, "redactMessages")) {
        if (typeof s.redactMessages === "boolean") redactMessages = s.redactMessages;
        else errors.add("/settings/redactMessages", MESSAGES.boolean);
      }
      if (Object.hasOwn(s, "messageMaxBytes")) {
        const n = s.messageMaxBytes;
        if (typeof n !== "number") errors.add("/settings/messageMaxBytes", MESSAGES.number);
        else if (!Number.isInteger(n)) errors.add("/settings/messageMaxBytes", MESSAGES.integer);
        else if (n < MESSAGE_MAX_BYTES_MIN || n > MESSAGE_MAX_BYTES_MAX) {
          errors.add("/settings/messageMaxBytes", rangeMessage(MESSAGE_MAX_BYTES_MIN, MESSAGE_MAX_BYTES_MAX));
        } else messageMaxBytes = n;
      }
      if (uploadJunit !== undefined && redactMessages !== undefined && messageMaxBytes !== undefined) {
        settings = { uploadJunit, redactMessages, messageMaxBytes };
      }
    }
  }

  if (
    errors.total > 0 ||
    version === undefined ||
    etag === undefined ||
    updatedAt === undefined ||
    policy === undefined ||
    quarantine === undefined ||
    settings === undefined
  ) {
    return { ok: false, errors: errors.finish() };
  }
  return {
    ok: true,
    response: { version, etag, updatedAt, policy, quarantine, settings },
    unknown: errors.unknown(),
  };
}
