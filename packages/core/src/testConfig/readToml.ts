import { type ConfigEntry, type ConfigValue, MAX_CONFIG_CHARS, normalizeOpaque, type ReadResult } from "./value.js";

const TABLE = /^\[\s*tool\s*\.\s*pytest\s*\.\s*ini_options\s*\]\s*(?:#.*)?$/;
/** The header of pytest 9's native table; `[tool.pytestx]`, `[tool.pytest.foo]` and `[[tool.pytest]]` do not match. */
const NATIVE_TABLE = /^\[\s*tool\s*\.\s*pytest\s*\]\s*(?:#.*)?$/;
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

/** The index of the first line break (`\n` or `\r`) at or after `from`, or -1. */
function breakAt(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13) return i;
  }
  return -1;
}

/** The index just after the line break at `at`; `\r\n` is one break. */
const afterBreak = (text: string, at: number): number =>
  at + (text.charCodeAt(at) === 13 && text.charCodeAt(at + 1) === 10 ? 2 : 1);

/**
 * The lines of a text from an offset on, split at `\r\n`, `\r` and `\n` like `text.split(/\r\n|\r|\n/)` (a text that ends
 * with a break has a last empty line), cut out one at a time as they are asked for. The first line held has index `first`.
 */
class Lines {
  private pos: number;
  private done: boolean;
  private readonly cache: string[] = [];

  constructor(
    private readonly text: string,
    from: number,
    private readonly first: number,
  ) {
    this.pos = from;
    this.done = from > text.length;
  }

  /** The line with index `i`, or undefined past the end of the text. */
  at(i: number): string | undefined {
    const k = i - this.first;
    while (this.cache.length <= k && !this.done) {
      const end = breakAt(this.text, this.pos);
      if (end === -1) {
        this.cache.push(this.text.slice(this.pos));
        this.done = true;
      } else {
        this.cache.push(this.text.slice(this.pos, end));
        this.pos = afterBreak(this.text, end);
      }
    }
    return this.cache[k];
  }
}

/**
 * The first line, in text order, that holds `needle` and is `header` once trimmed: its index and the offset of the line
 * after it (past the end of the text when it is the last line). Each line is looked at once, so the cost is linear.
 */
function headerAt(text: string, needle: string, header: RegExp): { line: number; next: number } | null {
  let from = 0;
  for (;;) {
    const hit = text.indexOf(needle, from);
    if (hit === -1) return null;
    let start = hit;
    while (start > 0 && text.charCodeAt(start - 1) !== 10 && text.charCodeAt(start - 1) !== 13) start--;
    const end = breakAt(text, hit);
    if (header.test(text.slice(start, end === -1 ? text.length : end).trim())) {
      let line = 0;
      for (let i = 0; i < start; i++) {
        const code = text.charCodeAt(i);
        if (code === 10 || (code === 13 && text.charCodeAt(i + 1) !== 10)) line++;
      }
      return { line, next: end === -1 ? text.length + 1 : afterBreak(text, end) };
    }
    if (end === -1) return null;
    from = end;
  }
}

/**
 * Reads the `key = value` lines of the table whose header is line `headerAt`, up to the next line that starts with `[`.
 * Null when the text must be refused as `invalid-toml`.
 */
function readTable(lines: Lines, headerAt: number): Map<string, ConfigEntry> | null {
  const entries = new Map<string, ConfigEntry>();
  let i = headerAt + 1;
  for (let raw = lines.at(i); raw !== undefined; raw = lines.at(i)) {
    const line = stripTomlComment(raw);
    if (line === "") {
      i++;
      continue;
    }
    if (line.startsWith("[")) break;
    const match = KEY_LINE.exec(line);
    if (match === null) return null;
    const rawKey = match[1] as string;
    let key = rawKey.replace(/^'|'$/g, "");
    if (rawKey.startsWith('"')) {
      try {
        key = JSON.parse(rawKey) as string;
      } catch {
        return null;
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
        const more = lines.at(i);
        if (more === undefined) return null;
        closed = more.includes(multi);
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
        const next = lines.at(i);
        if (next === undefined || HEADER_LINE.test(next.trim())) return null;
        const added = stripTomlComment(next);
        parts.push(added);
        scan = scanBrackets(added, 0, scan.depth);
      }
      if (scan === null) return null;
      value = arrayValue(parts.join(" "));
    } else {
      value = scalar(rest);
    }
    entries.set(key, { value, line: first + 1 });
    i++;
  }
  return entries;
}

/**
 * Reads the pytest tables of `pyproject.toml`: pytest 9's native `[tool.pytest]` and `[tool.pytest.ini_options]`. Each is
 * `key = value` lines whose value is a string, an integer, a float, a boolean or an array of these over one or more lines
 * (comments and a trailing comma allowed). Anything else (an inline table, a multi-line string) is opaque. An array not
 * closed before the next header or the end of the file, and any other line in a table, refuse the text as `invalid-toml`.
 * The first table of each kind is read; when both are present their entries are merged into one root, the
 * `ini_options` ones first and a native entry replacing an `ini_options` one of the same key, each entry keeping its own
 * line. The root is null when neither table is present.
 */
export function readToml(text: string): ReadResult {
  if (text.length > MAX_CONFIG_CHARS) return { ok: false, reason: "too-large" };
  // Both headers contain "pytest", and the ini_options one "ini_options": only the lines holding the word are looked at
  // for a header, and only the lines a table spans are cut out of the text, so most of a large file is never split.
  const starts = [headerAt(text, "ini_options", TABLE), headerAt(text, "pytest", NATIVE_TABLE)];
  if (starts[0] === null && starts[1] === null) return { ok: true, root: null };

  const entries = new Map<string, ConfigEntry>();
  for (const start of starts) {
    if (start === null) continue;
    const table = readTable(new Lines(text, start.next, start.line + 1), start.line);
    if (table === null) return { ok: false, reason: "invalid-toml" };
    for (const [key, entry] of table) entries.set(key, entry);
  }
  return { ok: true, root: { type: "object", entries, open: false, extras: [] } };
}
