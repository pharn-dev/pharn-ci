/**
 * A small TOML reader for pyproject.toml, poetry.lock and uv.lock (A13): tables, array tables, dotted and quoted keys,
 * basic, literal and multi-line strings, arrays (across lines) and inline tables (also across lines, as TOML 1.1 and
 * the readers poetry and uv use allow). Numbers, booleans and dates are kept as `other`. Hand-written, one pass over the
 * characters, nesting capped, so the cost stays linear on hostile input. A syntax error makes the whole file unreadable
 * (null): a half-read manifest would hide a dependency.
 *
 * The model is the TOML document as one nested table (`parseTomlDocument`): a dotted key (`source.url = …`, also inside
 * an inline table), a `[table]` header and an `[[array table]]` all land in the same tree, so `source` reads the same
 * whether it was written as a sub-table, an inline table or dotted keys (CORE-114). What TOML forbids makes the file
 * unreadable, as the spec says: a key defined twice, a dotted key that redefines a value or extends an inline table or a
 * table a header defined, a table header written twice, a header that reopens an inline table or a table defined with
 * dotted keys, and an array table over a static array.
 */

export type TomlValue =
  | { type: "string"; value: string; line: number }
  | { type: "array"; items: TomlValue[]; line: number }
  | { type: "table"; entries: Map<string, TomlValue>; line: number }
  | { type: "other"; line: number };

export type TomlTableValue = Extract<TomlValue, { type: "table" }>;

/**
 * One `[table]` or `[[array table]]` header (the first has the empty path: the top-level keys), with the keys written
 * under it, in order. A dotted key under the header is folded into a nested table, which is the document's own value: a
 * table reached through a dotted key shows everything the document holds in it. Keys a later header adds (`[a.b]` after
 * `[a]`) are not in the earlier header's `entries`; they are in the document's tree.
 */
export interface TomlTable {
  path: string[];
  array: boolean;
  line: number;
  entries: Map<string, TomlValue>;
}

/** A parsed TOML file: the whole document as one nested table, and its headers in file order. */
export interface TomlDocument {
  /**
   * Every key of the file in one tree: a `[a.b]` header is `root → a → b`, an `[[a]]` header appends a table to the
   * array `root → a`, and a dotted key `x.y = 1` is `x → y` under the table its header opened. A table's `line` is the
   * line of the header that defined it, or of the first key that created it.
   */
  root: TomlTableValue;
  /** The headers in file order, each with the keys written under it. */
  tables: TomlTable[];
}

const MAX_DEPTH = 32;

/** The one-character escapes of a basic string. */
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

class TomlError extends Error {}

const isBare = (c: string) =>
  (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_" || c === "-";

/**
 * How a table or array came to be, for the rules on defining it again: `implicit` (a parent a header named on its way,
 * which a later header may still define), `defined` (by a header or as an array table's element), `dotted` (created or
 * extended by dotted keys under the current header: more dotted keys there may extend it, later headers may not),
 * `frozen` (an inline table or a static array: nothing may be added), `array-table` (an `[[array table]]`'s array).
 */
type Origin = "implicit" | "defined" | "dotted" | "frozen" | "array-table";

const newTable = (line: number): TomlTableValue => ({ type: "table", entries: new Map(), line });

/** The headers of a TOML text, each with the keys written under it, or null when the text is not valid TOML. */
export function parseToml(text: string): TomlTable[] | null {
  return parseTomlDocument(text)?.tables ?? null;
}

/**
 * How a value of a parsed document came to be, for a reader that needs more than the tree (the pytest config reader):
 * `value` was written after a `=` (a string, an array, an inline table or another scalar) at `[start, end)` of the
 * text without its leading byte order mark; `header` is a table a `[header]` defined, an `[[array table]]`'s array or
 * one of its elements; `dotted` a table dotted keys made or extended; `implicit` a table only named on the way to a
 * deeper header.
 */
export type TomlOrigin = { kind: "value"; start: number; end: number } | { kind: "header" | "dotted" | "implicit" };

/**
 * A TOML text as one nested table (see `TomlDocument`), or null when the text is not valid TOML. When `origins` is
 * given, it is filled with how each table and each value written after a `=` came to be (see `TomlOrigin`).
 */
export function parseTomlDocument(text: string, origins?: Map<TomlValue, TomlOrigin>): TomlDocument | null {
  const record = (value: TomlValue, kind: "header" | "dotted" | "implicit") => origins?.set(value, { kind });
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
  /** The escape sequence whose backslash is at pos, decoded; pos moves past it. An unknown escape fails. */
  const escapeSequence = (): string => {
    const next = src[pos + 1];
    if (next === "u" || next === "U") {
      const size = next === "u" ? 4 : 8;
      const hex = src.slice(pos + 2, pos + 2 + size);
      const code = /^[0-9a-fA-F]+$/.test(hex) && hex.length === size ? Number.parseInt(hex, 16) : Number.NaN;
      if (!Number.isFinite(code) || code > 0x10ffff) fail();
      pos += 2 + size;
      return String.fromCodePoint(code);
    }
    const mapped = (next === undefined ? undefined : ESCAPES[next]) ?? fail();
    pos += 2;
    return mapped;
  };
  /** A multi-line basic string; pos is on its opening `"""`. */
  const multiLineBasicString = (): string => {
    pos += 3;
    // A line break right after the opening delimiter is not part of the string.
    if (src[pos] === "\n") pos++;
    else if (src[pos] === "\r" && src[pos + 1] === "\n") pos += 2;
    let out = "";
    // Character by character, so a `"""` whose first quote is escaped (`\"""`) does not close the string, while one
    // after an escaped backslash (`\\"""`) does.
    while (pos < end) {
      const ch = src[pos] as string;
      if (ch === '"' && src.startsWith('"""', pos)) {
        // A run of more than three quotes closes on its last three: the ones before them belong to the string.
        let stop = pos;
        while (src[stop + 3] === '"') stop++;
        out += src.slice(pos, stop);
        pos = stop + 3;
        return out;
      }
      if (ch === "\\") {
        // A backslash that ends a line drops the line break and all the whitespace and line breaks after it.
        let next = pos + 1;
        while (src[next] === " " || src[next] === "\t") next++;
        if (src[next] === "\n" || (src[next] === "\r" && src[next + 1] === "\n")) {
          pos = next;
          while (pos < end && " \t\r\n".includes(src[pos] as string)) pos++;
          continue;
        }
        out += escapeSequence();
        continue;
      }
      out += ch;
      pos++;
    }
    return fail();
  };
  const basicString = (): string => {
    // pos is on the opening quote.
    if (src.startsWith('"""', pos)) return multiLineBasicString();
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
        out += escapeSequence();
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
  /** A key's parts (`a."b.c".d` is `a`, `b.c`, `d`), at most MAX_DEPTH of them, so the tree's depth stays bounded. */
  const dottedKey = (): string[] => {
    const parts = [keyPart()];
    for (;;) {
      skipSpaces();
      if (src[pos] !== ".") return parts;
      if (parts.length >= MAX_DEPTH) fail();
      pos++;
      skipSpaces();
      parts.push(keyPart());
    }
  };

  const origin = new Map<TomlValue, Origin>();
  /** The tables dotted keys created or extended under the current header; a header makes them `defined`. */
  let dotted: TomlTableValue[] = [];
  /**
   * Sets `parts = value` in `table`. A missing parent becomes a table; an existing parent must be a table `open` allows
   * (else the key redefines a value), and the last part must be new.
   */
  const assign = (
    table: TomlTableValue,
    parts: string[],
    value: TomlValue,
    line: number,
    open: (parent: TomlTableValue) => boolean,
    created: (parent: TomlTableValue) => void,
  ) => {
    let target = table;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i] as string;
      const next = target.entries.get(key);
      if (next === undefined) {
        const child = newTable(line);
        target.entries.set(key, child);
        created(child);
        target = child;
      } else if (next.type === "table" && open(next)) {
        target = next;
      } else {
        fail();
      }
    }
    const last = parts[parts.length - 1] as string;
    if (target.entries.has(last)) fail();
    target.entries.set(last, value);
  };

  const value = (depth: number): TomlValue => {
    const start = pos;
    const parsed = parseValue(depth);
    origins?.set(parsed, { kind: "value", start, end: pos });
    return parsed;
  };
  const parseValue = (depth: number): TomlValue => {
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
      const table = newTable(line);
      // Inside one inline table, dotted keys may extend the tables earlier dotted keys of the same inline table made,
      // never an inline table written as a value.
      const made = new Set<TomlTableValue>();
      for (;;) {
        skipAll();
        if (src[pos] === "}") {
          pos++;
          return table;
        }
        const keyLine = lineAt(pos);
        const parts = dottedKey();
        skipSpaces();
        if (src[pos] !== "=") fail();
        pos++;
        skipSpaces();
        assign(
          table,
          parts,
          value(depth + 1),
          keyLine,
          (parent) => made.has(parent),
          (child) => {
            made.add(child);
            record(child, "dotted");
          },
        );
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

  /** The table a `[path]` or `[[path]]` header opens, creating, defining or appending as TOML says. */
  const openHeader = (root: TomlTableValue, path: string[], array: boolean, line: number): TomlTableValue => {
    let table = root;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i] as string;
      let next = table.entries.get(key);
      if (next === undefined) {
        next = newTable(line);
        origin.set(next, "implicit");
        record(next, "implicit");
        table.entries.set(key, next);
      } else if (next.type === "array" && origin.get(next) === "array-table") {
        // A header under an array table names its last element.
        next = next.items[next.items.length - 1];
      }
      if (next === undefined || next.type !== "table" || origin.get(next) === "frozen") fail();
      table = next as TomlTableValue;
    }
    const last = path[path.length - 1] as string;
    const existing = table.entries.get(last);
    if (array) {
      let list = existing;
      if (list === undefined) {
        list = { type: "array", items: [], line };
        origin.set(list, "array-table");
        record(list, "header");
        table.entries.set(last, list);
      } else if (list.type !== "array" || origin.get(list) !== "array-table") {
        fail();
      }
      const element = newTable(line);
      origin.set(element, "defined");
      record(element, "header");
      (list as Extract<TomlValue, { type: "array" }>).items.push(element);
      return element;
    }
    if (existing === undefined) {
      const created = newTable(line);
      origin.set(created, "defined");
      record(created, "header");
      table.entries.set(last, created);
      return created;
    }
    if (existing.type !== "table" || origin.get(existing) !== "implicit") fail();
    const defined = existing as TomlTableValue;
    origin.set(defined, "defined");
    record(defined, "header");
    defined.line = line;
    return defined;
  };

  const root = newTable(1);
  origin.set(root, "defined");
  const tables: TomlTable[] = [{ path: [], array: false, line: 1, entries: new Map() }];
  let current = root;
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
        for (const table of dotted) origin.set(table, "defined");
        dotted = [];
        current = openHeader(root, path, array, line);
        tables.push({ path, array, line, entries: new Map() });
        continue;
      }
      const parts = dottedKey();
      skipSpaces();
      if (src[pos] !== "=") fail();
      pos++;
      skipSpaces();
      const parsed = value(0);
      endOfLine();
      if (parsed.type === "table" || parsed.type === "array") origin.set(parsed, "frozen");
      assign(
        current,
        parts,
        parsed,
        line,
        (parent) => {
          const from = origin.get(parent);
          if (from === "implicit") {
            origin.set(parent, "dotted");
            record(parent, "dotted");
            dotted.push(parent);
          }
          return from === "implicit" || from === "dotted";
        },
        (child) => {
          origin.set(child, "dotted");
          record(child, "dotted");
          dotted.push(child);
        },
      );
      const header = tables[tables.length - 1] as TomlTable;
      const first = parts[0] as string;
      if (!header.entries.has(first)) header.entries.set(first, current.entries.get(first) as TomlValue);
    }
  } catch (error) {
    if (error instanceof TomlError) return null;
    throw error;
  }
  return { root, tables };
}

/** Whether a table's path is exactly `path`. */
export function isTable(table: TomlTable, path: readonly string[]): boolean {
  return table.path.length === path.length && table.path.every((part, i) => part === path[i]);
}

/** The value at `path` under `table` (`["tool", "poetry"]` is `table → tool → poetry`), through tables only. */
export function valueAt(table: TomlTableValue, path: readonly string[]): TomlValue | undefined {
  let value: TomlValue | undefined = table;
  for (const key of path) {
    if (value?.type !== "table") return undefined;
    value = value.entries.get(key);
  }
  return value;
}
