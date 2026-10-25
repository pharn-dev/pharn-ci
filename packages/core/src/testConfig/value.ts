/** Values nested deeper than this are read as opaque. */
export const MAX_CONFIG_VALUE_DEPTH = 64;
/** The longest config text (in UTF-16 code units) TI09 reads; longer text is refused as `too-large`. */
export const MAX_CONFIG_CHARS = 524_288;
/** The most top-level `const` names followed from one identifier. */
export const MAX_CONFIG_IDENT_HOPS = 8;
/** The longest value text a finding carries, in UTF-16 code units, before the cut mark. */
export const MAX_VALUE_CHARS = 80;
/** The longest key text a finding carries, in UTF-16 code units, before the cut mark. */
export const MAX_KEY_CHARS = 100;

/** One property of an object value: its value and the 1-based line of its name in that side's text (null when unknown). */
export interface ConfigEntry {
  value: ConfigValue;
  line: number | null;
}

/**
 * A config value as TI09 reads it. `opaque` is anything that is not a literal: its text is the normalized source. An
 * `open` object may hold keys the reader could not see (a spread, a shorthand property, a computed key, a method, or a
 * `mergeConfig` result); `extras` holds the normalized texts of those.
 */
export type ConfigValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "null" }
  | { type: "array"; items: ConfigValue[] }
  | { type: "object"; entries: Map<string, ConfigEntry>; open: boolean; extras: string[] }
  | { type: "opaque"; text: string };

/**
 * What a reader gives for one config text: the root value (null when the text holds no section or table to read), or
 * the reason the text was refused: `too-large`, `too-deep`, `syntax-error`, `invalid-json`, `invalid-yaml`,
 * `invalid-ini` or `invalid-toml`.
 */
export type ReadResult = { ok: true; root: ConfigValue | null } | { ok: false; reason: string };

/** The result of looking a key path up in a value. */
export type Lookup = { found: ConfigEntry } | "unset" | "unknown";

/**
 * Looks `path` up from `root`. `unset` means the key is not there: absent from a closed object, or below an unset or
 * non-object parent. `unknown` means it may be there: absent from an open object, or below an opaque parent.
 */
export function lookup(root: ConfigValue, path: readonly string[]): Lookup {
  let current: ConfigValue = root;
  let entry: ConfigEntry | null = null;
  for (const segment of path) {
    if (current.type === "opaque") return "unknown";
    if (current.type !== "object") return "unset";
    const next: ConfigEntry | undefined = current.entries.get(segment);
    if (next === undefined) return current.open ? "unknown" : "unset";
    entry = next;
    current = next.value;
  }
  return entry === null ? "unset" : { found: entry };
}

/** Replaces each control character and each lone surrogate with U+FFFD. */
function replaceUnsafe(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text.slice(i, i + 2);
        i++;
      } else {
        out += "�";
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      out += "�";
    } else if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f) || unit === 0x2028 || unit === 0x2029) {
      out += "�";
    } else {
      out += text[i];
    }
  }
  return out;
}

/** The text with unsafe characters replaced, cut past `limit` code units (one fewer when the cut would split a pair). */
function cutText(text: string, limit: number): string {
  const safe = replaceUnsafe(text);
  if (safe.length <= limit) return safe;
  const high = safe.charCodeAt(limit - 1);
  const end = high >= 0xd800 && high <= 0xdbff ? limit - 1 : limit;
  return `${safe.slice(0, end)}…`;
}

/** A value text for a finding: control characters and lone surrogates become U+FFFD, then cut past 80 code units. */
export function cutValue(text: string): string {
  return cutText(text, MAX_VALUE_CHARS);
}

/** A detail sentence of at most the 300 code units the report allows: past that, 299 and the cut mark. */
export function cutDetail(text: string): string {
  const safe = replaceUnsafe(text);
  if (safe.length <= 300) return safe;
  const high = safe.charCodeAt(298);
  return `${safe.slice(0, high >= 0xd800 && high <= 0xdbff ? 298 : 299)}…`;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const DIGITS = /^\d+$/;

/**
 * The dotted key text of a path. A segment that is not an identifier or all digits is written `["…"]` with JSON quoting.
 * Control characters are replaced and the whole is cut past 100 code units.
 */
export function keyText(segments: readonly string[]): string {
  let out = "";
  for (const segment of segments) {
    if (IDENTIFIER.test(segment) || DIGITS.test(segment)) out += out === "" ? segment : `.${segment}`;
    else out += `[${JSON.stringify(segment)}]`;
  }
  return cutText(out, MAX_KEY_CHARS);
}

const isIdentChar = (ch: string | undefined): boolean =>
  ch !== undefined && (/[\w$]/.test(ch) || ch.charCodeAt(0) > 127);

/**
 * The source text of an expression with `//` and block comments dropped outside string and template literals and
 * whitespace deleted, except one space kept between two identifier characters. Written by hand, so two spellings of
 * the same expression that differ in layout only print the same.
 */
export function normalizeOpaque(source: string): string {
  let out = "";
  let pendingSpace = false;
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? source.length : close + 2;
      pendingSpace = pendingSpace || out !== "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
      pendingSpace = false;
      out += source.slice(i, Math.min(j + 1, source.length));
      i = j + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      pendingSpace = out !== "";
      i++;
      continue;
    }
    if (pendingSpace && isIdentChar(out[out.length - 1]) && isIdentChar(ch)) out += " ";
    pendingSpace = false;
    out += ch;
    i++;
  }
  return out;
}

/**
 * The compact text of a value, stable under reformatting: static values as JSON with object keys sorted, opaque values
 * as their normalized text. Two values are equal when their printed texts are equal.
 */
export function printValue(value: ConfigValue): string {
  switch (value.type) {
    case "string":
    case "number":
    case "boolean":
      return JSON.stringify(value.value);
    case "null":
      return "null";
    case "opaque":
      return value.text;
    case "array":
      return `[${value.items.map(printValue).join(",")}]`;
    case "object": {
      const keys = [...value.entries.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const parts = keys.map(
        (key) => `${JSON.stringify(key)}:${printValue((value.entries.get(key) as ConfigEntry).value)}`,
      );
      for (const extra of [...value.extras].sort()) parts.push(`...${extra}`);
      return `{${parts.join(",")}}`;
    }
  }
}

/** A closed object with no keys. */
export function emptyObject(open = false): ConfigValue {
  return { type: "object", entries: new Map(), open, extras: [] };
}

/** Whether a value is a literal: it holds no opaque part. */
export function isStatic(value: ConfigValue): boolean {
  switch (value.type) {
    case "opaque":
      return false;
    case "array":
      return value.items.every(isStatic);
    case "object":
      return !value.open && [...value.entries.values()].every((entry) => isStatic(entry.value));
    default:
      return true;
  }
}
