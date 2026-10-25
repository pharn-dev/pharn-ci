import { type ConfigEntry, MAX_CONFIG_CHARS, type ReadResult } from "./value.js";

/**
 * A `key = value` or `key: value` line split at its first `=` or `:`: the key without trailing whitespace and the
 * value trimmed. Null when the line starts with whitespace, `=` or `:`, or has neither. A scan, not a regular
 * expression, so a long hostile line costs linear time.
 */
function splitKeyLine(raw: string): { key: string; value: string } | null {
  const first = raw[0];
  if (first === undefined || first === "=" || first === ":" || first.trim() === "") return null;
  let at = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "=" || raw[i] === ":") {
      at = i;
      break;
    }
  }
  if (at === -1) return null;
  return { key: raw.slice(0, at).trimEnd(), value: raw.slice(at + 1).trim() };
}

const isHeader = (line: string) => line.startsWith("[") && line.trimEnd().endsWith("]");

/**
 * Reads one section of an INI file (`[pytest]` of `pytest.ini` and `tox.ini`, `[tool:pytest]` of `setup.cfg`). Only that
 * section is read: it ends at the next header line, and the lines outside it are never judged. A line inside it is a
 * blank, a full-line `#` or `;` comment, a `key = value` or `key: value` line (the last copy of a key wins), or an
 * indented continuation, joined to the value with one space. An inline `#` after a value is kept. Any other line
 * refuses the text as `invalid-ini`. The root is null when the section is absent.
 */
export function readIni(text: string, section: string): ReadResult {
  if (text.length > MAX_CONFIG_CHARS) return { ok: false, reason: "too-large" };
  const lines = text.split(/\r\n|\r|\n/);
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trimEnd() === header);
  if (start === -1) return { ok: true, root: null };

  // The parts of each key's value, joined once at the end, so many continuation lines cost linear time.
  const parts = new Map<string, { line: number; parts: string[] }>();
  let last: string | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i] as string;
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    if (isHeader(raw)) break;
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (/^\s/.test(raw) && last !== null) {
      (parts.get(last) as { parts: string[] }).parts.push(trimmed);
      continue;
    }
    const split = splitKeyLine(raw);
    if (split === null) return { ok: false, reason: "invalid-ini" };
    // The last copy of a key wins: its parts start again.
    parts.set(split.key, { line: i + 1, parts: split.value === "" ? [] : [split.value] });
    last = split.key;
  }
  const entries = new Map<string, ConfigEntry>();
  for (const [key, entry] of parts) {
    entries.set(key, { value: { type: "string", value: entry.parts.join(" ") }, line: entry.line });
  }
  return { ok: true, root: { type: "object", entries, open: false, extras: [] } };
}
