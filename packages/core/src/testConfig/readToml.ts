import { parseTomlDocument, type TomlOrigin, type TomlValue, valueAt } from "../dependencies/toml.js";
import { type ConfigEntry, type ConfigValue, MAX_CONFIG_CHARS, normalizeOpaque, type ReadResult } from "./value.js";

const NUMBER = /^[-+]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d+)?$/;
const INI_OPTIONS = ["tool", "pytest", "ini_options"] as const;
const NATIVE = ["tool", "pytest"] as const;

/** The index of the quote that closes the string opened at `open`, or -1. */
function stringEnd(text: string, open: number): number {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/** A scalar token as a value: a string, boolean or number; anything else (a date, a multi-line string, hex) is opaque. */
function scalar(text: string): ConfigValue {
  if (text.startsWith('"') || text.startsWith("'")) {
    const end = stringEnd(text, 0);
    if (end === text.length - 1) {
      if (text.startsWith("'")) return { type: "string", value: text.slice(1, end) };
      try {
        const decoded: unknown = JSON.parse(text);
        if (typeof decoded === "string") return { type: "string", value: decoded };
      } catch {
        // an escape JSON does not have: the value is opaque
      }
    }
    return { type: "opaque", text: normalizeOpaque(text) };
  }
  if (text === "true") return { type: "boolean", value: true };
  if (text === "false") return { type: "boolean", value: false };
  if (NUMBER.test(text)) return { type: "number", value: Number(text.replace(/_/g, "")) };
  return { type: "opaque", text: normalizeOpaque(text) };
}

/** The source text of a value with its TOML comments (a `#` outside a string, to the end of its line) dropped. */
function withoutComments(text: string): string {
  let out = "";
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const delimiter = text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      let j = i + delimiter.length;
      while (j < text.length && !text.startsWith(delimiter, j)) j += ch === '"' && text[j] === "\\" ? 2 : 1;
      i = j + delimiter.length - 1;
    } else if (ch === "#") {
      out += text.slice(from, i);
      while (i < text.length && text[i] !== "\n") i++;
      from = i;
    }
  }
  return out + text.slice(from);
}

/**
 * A value written after a `=`, as TI09 reads it: a scalar from its source text, an array item by item, and an inline
 * table or a nested array as opaque normalized source.
 */
function configValue(
  value: TomlValue,
  origins: ReadonlyMap<TomlValue, TomlOrigin>,
  src: string,
  nested: boolean,
): ConfigValue {
  const origin = origins.get(value);
  const raw = origin?.kind === "value" ? src.slice(origin.start, origin.end) : "";
  if (value.type === "table" || (value.type === "array" && nested)) {
    return { type: "opaque", text: normalizeOpaque(withoutComments(raw)) };
  }
  if (value.type === "array")
    return { type: "array", items: value.items.map((item) => configValue(item, origins, src, true)) };
  return scalar(raw.trim());
}

/**
 * The entries of one pytest table: each key written after a `=` with its own line, a table dotted keys made folded back
 * into `a.b` keys, and a table a header defined (a sub-table, an array table) left out.
 */
function collect(
  table: Extract<TomlValue, { type: "table" }>,
  prefix: string,
  origins: ReadonlyMap<TomlValue, TomlOrigin>,
  src: string,
  into: Map<string, ConfigEntry>,
  skip: string | null,
): void {
  for (const [key, value] of table.entries) {
    if (key === skip) continue;
    const kind = origins.get(value)?.kind;
    if (kind === "value") into.set(prefix + key, { value: configValue(value, origins, src, false), line: value.line });
    else if (kind === "dotted" && value.type === "table") collect(value, `${prefix}${key}.`, origins, src, into, null);
  }
}

/**
 * Reads the pytest tables of `pyproject.toml`: pytest 9's native `[tool.pytest]` and `[tool.pytest.ini_options]`, from
 * the nested TOML document (`parseTomlDocument`), so a table reads the same whether it is written as a header (quoted
 * or spaced parts included), dotted keys or an inline table. A value that is a string, an integer, a float or a boolean
 * is read as one; an array item by item; anything else (an inline table, a multi-line string, a date) is opaque. A text
 * that is not valid TOML is refused as `invalid-toml`, as pytest refuses it. When both tables are present their entries
 * are merged into one root, the `ini_options` ones first and a native entry replacing an `ini_options` one of the same
 * key, each entry keeping its own line. The root is null when neither table is present (a table only named on the way
 * to a deeper header is not present).
 */
export function readToml(text: string): ReadResult {
  if (text.length > MAX_CONFIG_CHARS) return { ok: false, reason: "too-large" };
  const origins = new Map<TomlValue, TomlOrigin>();
  const document = parseTomlDocument(text, origins);
  if (document === null) return { ok: false, reason: "invalid-toml" };
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const entries = new Map<string, ConfigEntry>();
  let present = false;
  for (const [path, skip] of [
    [INI_OPTIONS, null],
    [NATIVE, "ini_options"],
  ] as const) {
    const table = valueAt(document.root, path);
    if (table?.type !== "table" || origins.get(table)?.kind === "implicit") continue;
    present = true;
    collect(table, "", origins, src, entries, skip);
  }
  return { ok: true, root: present ? { type: "object", entries, open: false, extras: [] } : null };
}
