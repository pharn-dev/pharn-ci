/**
 * A small TOML reader for pyproject.toml, poetry.lock and uv.lock (A13): tables, array tables, dotted and quoted keys,
 * basic, literal and multi-line strings, arrays (across lines) and inline tables. Numbers, booleans and dates are kept
 * as `other`. Hand-written, one pass over the characters, nesting capped, so the cost stays linear on hostile input. A
 * syntax error makes the whole file unreadable (null): a half-read manifest would hide a dependency.
 */

export type TomlValue =
  | { type: "string"; value: string; line: number }
  | { type: "array"; items: TomlValue[]; line: number }
  | { type: "table"; entries: Map<string, TomlValue>; line: number }
  | { type: "other"; line: number };

/** One `[table]` or `[[array table]]` (the first has the empty path: the top-level keys), with its keys in order. */
export interface TomlTable {
  path: string[];
  array: boolean;
  line: number;
  /** Dotted keys joined with `.`. */
  entries: Map<string, TomlValue>;
}

const MAX_DEPTH = 32;

class TomlError extends Error {}

const isBare = (c: string) =>
  (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_" || c === "-";

export function parseToml(text: string): TomlTable[] | null {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (pos: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] as number) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  let pos = 0;
  const end = src.length;
  const fail = (): never => {
    throw new TomlError();
  };
  /** Spaces and tabs only. */
  const skipSpaces = () => {
    while (pos < end && (src[pos] === " " || src[pos] === "\t")) pos++;
  };
  /** Spaces, tabs, newlines and comments. */
  const skipAll = () => {
    for (;;) {
      skipSpaces();
      if (src[pos] === "\r" || src[pos] === "\n") pos++;
      else if (src[pos] === "#") {
        while (pos < end && src[pos] !== "\n") pos++;
      } else return;
    }
  };
  const endOfLine = () => {
    skipSpaces();
    if (src[pos] === "#") while (pos < end && src[pos] !== "\n") pos++;
    if (src[pos] === "\r") pos++;
    if (pos < end && src[pos] !== "\n") fail();
  };
  const basicString = (): string => {
    // pos is on the opening quote.
    if (src.startsWith('"""', pos)) {
      const close = src.indexOf('"""', pos + 3);
      if (close === -1) fail();
      let stop = close;
      // A run of more than three quotes closes on its last three.
      while (src[stop + 3] === '"') stop++;
      const value = src.slice(pos + 3, stop);
      pos = stop + 3;
      return value;
    }
    let out = "";
    pos++;
    while (pos < end) {
      const ch = src[pos] as string;
      if (ch === '"') {
        pos++;
        return out;
      }
      if (ch === "\n") fail();
      if (ch === "\\") {
        const next = src[pos + 1];
        if (next === "u" || next === "U") {
          const size = next === "u" ? 4 : 8;
          const hex = src.slice(pos + 2, pos + 2 + size);
          const code = /^[0-9a-fA-F]+$/.test(hex) && hex.length === size ? Number.parseInt(hex, 16) : Number.NaN;
          if (!Number.isFinite(code) || code > 0x10ffff) fail();
          out += String.fromCodePoint(code);
          pos += 2 + size;
          continue;
        }
        const map: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        const mapped = next === undefined ? undefined : map[next];
        if (mapped === undefined) fail();
        out += mapped;
        pos += 2;
        continue;
      }
      out += ch;
      pos++;
    }
    return fail();
  };
  const literalString = (): string => {
    if (src.startsWith("'''", pos)) {
      const close = src.indexOf("'''", pos + 3);
      if (close === -1) fail();
      let stop = close;
      while (src[stop + 3] === "'") stop++;
      const value = src.slice(pos + 3, stop);
      pos = stop + 3;
      return value;
    }
    const close = src.indexOf("'", pos + 1);
    const newline = src.indexOf("\n", pos + 1);
    if (close === -1 || (newline !== -1 && newline < close)) fail();
    const value = src.slice(pos + 1, close);
    pos = close + 1;
    return value;
  };
  const keyPart = (): string => {
    const ch = src[pos];
    if (ch === '"') {
      if (src.startsWith('"""', pos)) fail();
      return basicString();
    }
    if (ch === "'") {
      if (src.startsWith("'''", pos)) fail();
      return literalString();
    }
    const start = pos;
    while (pos < end && isBare(src[pos] as string)) pos++;
    if (pos === start) fail();
    return src.slice(start, pos);
  };
  const dottedKey = (): string[] => {
    const parts = [keyPart()];
    for (;;) {
      skipSpaces();
      if (src[pos] !== ".") return parts;
      pos++;
      skipSpaces();
      parts.push(keyPart());
    }
  };
  const value = (depth: number): TomlValue => {
    if (depth > MAX_DEPTH) fail();
    const line = lineAt(pos);
    const ch = src[pos];
    if (ch === '"') return { type: "string", value: basicString(), line };
    if (ch === "'") return { type: "string", value: literalString(), line };
    if (ch === "[") {
      pos++;
      const items: TomlValue[] = [];
      for (;;) {
        skipAll();
        if (src[pos] === "]") {
          pos++;
          return { type: "array", items, line };
        }
        items.push(value(depth + 1));
        skipAll();
        if (src[pos] === ",") pos++;
        else if (src[pos] !== "]") fail();
      }
    }
    if (ch === "{") {
      pos++;
      const entries = new Map<string, TomlValue>();
      for (;;) {
        skipAll();
        if (src[pos] === "}") {
          pos++;
          return { type: "table", entries, line };
        }
        const key = dottedKey().join(".");
        skipSpaces();
        if (src[pos] !== "=") fail();
        pos++;
        skipSpaces();
        entries.set(key, value(depth + 1));
        skipAll();
        if (src[pos] === ",") pos++;
        else if (src[pos] !== "}") fail();
      }
    }
    const start = pos;
    while (pos < end && !",]}\n#\r".includes(src[pos] as string)) pos++;
    if (src.slice(start, pos).trim() === "") fail();
    return { type: "other", line };
  };

  const tables: TomlTable[] = [{ path: [], array: false, line: 1, entries: new Map() }];
  try {
    for (;;) {
      skipAll();
      if (pos >= end) break;
      const line = lineAt(pos);
      if (src[pos] === "[") {
        const array = src[pos + 1] === "[";
        pos += array ? 2 : 1;
        skipSpaces();
        const path = dottedKey();
        skipSpaces();
        if (array ? !src.startsWith("]]", pos) : src[pos] !== "]") fail();
        pos += array ? 2 : 1;
        endOfLine();
        tables.push({ path, array, line, entries: new Map() });
        continue;
      }
      const key = dottedKey().join(".");
      skipSpaces();
      if (src[pos] !== "=") fail();
      pos++;
      skipSpaces();
      const parsed = value(0);
      endOfLine();
      (tables[tables.length - 1] as TomlTable).entries.set(key, parsed);
    }
  } catch (error) {
    if (error instanceof TomlError) return null;
    throw error;
  }
  return tables;
}

/** Whether a table's path is exactly `path`. */
export function isTable(table: TomlTable, path: readonly string[]): boolean {
  return table.path.length === path.length && table.path.every((part, i) => part === path[i]);
}
