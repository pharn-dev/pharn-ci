import { QUARANTINE_ITEM_MAX_UNITS, RESPONSE_MAX_QUARANTINE_ITEMS } from "../policy/response.js";

/** The most bytes of a quarantine file the CLI reads (1 MiB). */
export const QUARANTINE_FILE_MAX_BYTES = 1_048_576;

/** A control character, or the line or paragraph separator: what the app's quarantine items may not hold either. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/**
 * The test ids of a quarantine list given as parsed JSON (the CLI's `--quarantine-file`), under the rules the app's
 * policy response follows: an array of at most 10,000 strings, each 1 to 1024 UTF-16 code units with no control
 * character. On a problem, a fixed text that names the index of the first bad item and never repeats a value.
 */
export function parseQuarantineList(value: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "must be a JSON array of test ids" };
  if (value.length > RESPONSE_MAX_QUARANTINE_ITEMS) {
    return { ok: false, error: `must have at most ${RESPONSE_MAX_QUARANTINE_ITEMS} items` };
  }
  const ids: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (typeof item !== "string" || item === "" || item.length > QUARANTINE_ITEM_MAX_UNITS || hasControl(item)) {
      return {
        ok: false,
        error: `item ${i} must be a test id of 1 to ${QUARANTINE_ITEM_MAX_UNITS} characters with no control character`,
      };
    }
    ids.push(item);
  }
  return { ok: true, ids };
}
