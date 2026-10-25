import { MAX_TEST_INDEX_DEPTH } from "../testIndex/types.js";
import {
  type ConfigEntry,
  type ConfigValue,
  MAX_CONFIG_CHARS,
  MAX_CONFIG_VALUE_DEPTH,
  type ReadResult,
} from "./value.js";

/** Whether brackets outside strings nest deeper than the bound. A linear scan, so it is safe before `JSON.parse`. */
function tooDeep(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
      if (depth > MAX_TEST_INDEX_DEPTH) return true;
    } else if (ch === "}" || ch === "]") {
      depth--;
    }
  }
  return false;
}

/** A parsed JSON value in the value model. Past the depth bound a value is opaque, as its compact JSON. */
function toValue(json: unknown, depth: number): ConfigValue {
  if (depth > MAX_CONFIG_VALUE_DEPTH) return { type: "opaque", text: JSON.stringify(json) };
  if (typeof json === "string") return { type: "string", value: json };
  if (typeof json === "number") return { type: "number", value: json };
  if (typeof json === "boolean") return { type: "boolean", value: json };
  if (json === null) return { type: "null" };
  if (Array.isArray(json)) return { type: "array", items: json.map((item) => toValue(item, depth + 1)) };
  const entries = new Map<string, ConfigEntry>();
  for (const key of Object.keys(json as object)) {
    entries.set(key, { value: toValue((json as Record<string, unknown>)[key], depth + 1), line: null });
  }
  return { type: "object", entries, open: false, extras: [] };
}

/** Reads a JSON test-runner config. Every line is null. Refuses a text that is too large, too deep or not JSON. */
export function readJson(text: string): ReadResult {
  if (text.length > MAX_CONFIG_CHARS) return { ok: false, reason: "too-large" };
  if (tooDeep(text)) return { ok: false, reason: "too-deep" };
  try {
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return { ok: true, root: toValue(JSON.parse(source), 0) };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}
