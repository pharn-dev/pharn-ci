import { type ConfigEntry, type ConfigValue, MAX_CONFIG_CHARS, normalizeOpaque, type ReadResult } from "./value.js";

const TABLE = /^\[\s*tool\s*\.\s*pytest\s*\.\s*ini_options\s*\]\s*(?:#.*)?$/;
/** A table header line, as seen where an unclosed array would otherwise swallow it. */
const HEADER_LINE = /^\[\[?[A-Za-z0-9_.\s-]+\]\]?\s*(?:#.*)?$/;
const KEY_LINE = /^([A-Za-z0-9_.-]+|"(?:[^"\\]|\\.)*"|'[^']*')\s*=([\s\S]*)$/;
const NUMBER = /^[-+]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d+)?$/;

/** The index of the quote that closes the string opened at `open`, or -1. */
function stringEnd(text: string, open: number): number {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/** The line without a trailing `#` comment (a `#` outside a string), trimmed. */
function stripTomlComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      const end = stringEnd(line, i);
      if (end === -1) return line.trim();
      i = end;
    } else if (ch === "#") {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

/** A scalar token as a value: a string, boolean or number; anything else (a date, an inline table, hex) is opaque. */
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

/**
 * Scans `text` from `from` with `depth` brackets already open, string-aware: the index of the bracket that closes the
 * outermost one (`close`), or -1 with the depth still open; null when a string is not closed on the text.
 */
function scanBrackets(text: string, from: number, depth: number): { close: number; depth: number } | null {
  let open = depth;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const end = stringEnd(text, i);
      if (end === -1) return null;
      i = end;
    } else if (ch === "[" || ch === "{") {
      open++;
    } else if (ch === "]" || ch === "}") {
      open--;
      if (open === 0) return { close: i, depth: 0 };
    }
  }
  return { close: -1, depth: open };
}

/** The index of the bracket that closes the one opened at `open`, string-aware, or -1. */
function closeOf(text: string, open: number): number {
  return scanBrackets(text, open, 0)?.close ?? -1;
}

/** The items of an array text that starts with `[` and is balanced. */
function arrayValue(text: string): ConfigValue {
  const items: ConfigValue[] = [];
  let i = 1;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === "]") break;
    if (/\s/.test(ch) || ch === ",") {
      i++;
    } else if (ch === '"' || ch === "'") {
      const end = stringEnd(text, i);
      if (end === -1) break;
      items.push(scalar(text.slice(i, end + 1)));
      i = end + 1;
    } else if (ch === "[" || ch === "{") {
      const end = closeOf(text, i);
      if (end === -1) break;
      items.push({ type: "opaque", text: normalizeOpaque(text.slice(i, end + 1)) });
      i = end + 1;
    } else {
      let end = i;
      while (end < text.length && text[end] !== "," && text[end] !== "]") end++;
      items.push(scalar(text.slice(i, end).trim()));
      i = end;
    }
  }
  return { type: "array", items };
}

/**
 * Reads the `[tool.pytest.ini_options]` table of `pyproject.toml`: `key = value` lines whose value is a string, an
 * integer, a float, a boolean or an array of these over one or more lines (comments and a trailing comma allowed).
 * Anything else (an inline table, a multi-line string) is opaque. An array not closed before the next header or the end
 * of the file, and any other line in the table, refuse the text as `invalid-toml`. The root is null when the table is
 * absent.
 */
export function readToml(text: string): ReadResult {
  if (text.length > MAX_CONFIG_CHARS) return { ok: false, reason: "too-large" };
  const lines = text.split(/\r\n|\r|\n/);
  const start = lines.findIndex((line) => TABLE.test(line.trim()));
  if (start === -1) return { ok: true, root: null };

  const entries = new Map<string, ConfigEntry>();
  let i = start + 1;
  while (i < lines.length) {
    const raw = lines[i] as string;
    const line = stripTomlComment(raw);
    if (line === "") {
      i++;
      continue;
    }
    if (line.startsWith("[")) break;
    const match = KEY_LINE.exec(line);
    if (match === null) return { ok: false, reason: "invalid-toml" };
    const rawKey = match[1] as string;
    let key = rawKey.replace(/^'|'$/g, "");
    if (rawKey.startsWith('"')) {
      try {
        key = JSON.parse(rawKey) as string;
      } catch {
        return { ok: false, reason: "invalid-toml" };
      }
    }
    const rest = (match[2] as string).trim();
    const first = i;

    const multi = rest.startsWith('"""') ? '"""' : rest.startsWith("'''") ? "'''" : null;
    if (multi !== null) {
      // The closing delimiter cannot span a line break, so each line is looked at once.
      let closed = rest.slice(3).includes(multi);
      while (!closed) {
        i++;
        if (i >= lines.length) return { ok: false, reason: "invalid-toml" };
        closed = (lines[i] as string).includes(multi);
      }
      entries.set(key, { value: { type: "opaque", text: normalizeOpaque(rest) }, line: first + 1 });
      i++;
      continue;
    }

    let value: ConfigValue;
    if (rest.startsWith("[")) {
      // Each added line is scanned once, carrying the open depth, so a long unclosed array costs linear time. A
      // string cannot span lines in TOML, so one left open on a line refuses the text.
      const parts = [rest];
      let scan = scanBrackets(rest, 0, 0);
      while (scan !== null && scan.close === -1) {
        i++;
        const next = lines[i];
        if (next === undefined || HEADER_LINE.test(next.trim())) return { ok: false, reason: "invalid-toml" };
        const added = stripTomlComment(next);
        parts.push(added);
        scan = scanBrackets(added, 0, scan.depth);
      }
      if (scan === null) return { ok: false, reason: "invalid-toml" };
      value = arrayValue(parts.join(" "));
    } else {
      value = scalar(rest);
    }
    entries.set(key, { value, line: first + 1 });
    i++;
  }
  return { ok: true, root: { type: "object", entries, open: false, extras: [] } };
}
