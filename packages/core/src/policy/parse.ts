import { MESSAGES, textTooLongMessage } from "./errors.js";
import { POLICY_MAX_CHARS } from "./limits.js";
import type { PolicyValidation } from "./types.js";
import { validatePolicy } from "./validate.js";

function fail(message: string): PolicyValidation {
  return { ok: false, errors: [{ path: "", message }] };
}

/**
 * Reads policy JSON text and validates it. A leading byte-order mark is dropped; text over `POLICY_MAX_CHARS`
 * UTF-16 code units is refused before `JSON.parse` runs; a parse failure gives one fixed error, never the engine's
 * own message, which quotes the input. Never throws.
 */
export function parsePolicyJson(text: string): PolicyValidation {
  if (typeof text !== "string") return fail(MESSAGES.textNotString);
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.length > POLICY_MAX_CHARS) return fail(textTooLongMessage(POLICY_MAX_CHARS));
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail(MESSAGES.textNotJson);
  }
  return validatePolicy(parsed);
}
