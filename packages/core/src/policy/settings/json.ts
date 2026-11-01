/**
 * A hand-written JSON parser for the agent settings and MCP files (E3 item 23, policy settings). It tracks lines (a
 * value's first character, an object member's key), keeps objects as `Map`s so `__proto__` is an ordinary key, reports
 * duplicate keys, and is iterative (an explicit stack), so a hostile file cannot overflow the call stack. It never
 * throws and a failure holds no input text: exactly `{ ok: false, reason }`.
 */

export type JsonValue =
  | { type: "string"; value: string; line: number }
  | { type: "number"; value: number; line: number }
  | { type: "boolean"; value: boolean; line: number }
  | { type: "null"; line: number }
  | { type: "array"; items: JsonValue[]; line: number }
  | { type: "object"; members: Map<string, JsonMember>; line: number };

export interface JsonMember {
  keyLine: number;
  value: JsonValue;
}

export type SettingsJsonResult =
  | { ok: true; value: JsonValue; duplicates: { reason: "duplicate-key"; line: number }[] }
  | { ok: false; reason: "not-json" | "too-deep" };

/** The deepest nesting that parses; the 65th open `[` or `{` is `too-deep`. */
const MAX_DEPTH = 64;

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

type Frame =
  | { kind: "array"; items: JsonValue[]; line: number }
  | { kind: "object"; members: Map<string, JsonMember>; line: number; key: string; keyLine: number };

type Mode = "value" | "arrayFirst" | "objectFirst" | "key" | "after";

const HEX = /^[0-9a-fA-F]{4}$/;

export function parseSettingsJson(text: string, options: { jsonc: boolean }): SettingsJsonResult {
  const jsonc = options.jsonc;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const end = src.length;
  const notJson = (): SettingsJsonResult => ({ ok: false, reason: "not-json" });
  const duplicates: { reason: "duplicate-key"; line: number }[] = [];
  const stack: Frame[] = [];
  let pos = 0;
  let line = 1;
  let root: JsonValue | undefined;

  /** Skip whitespace (and, for JSONC, comments), counting lines. False for an unterminated block comment. */
  const skip = (): boolean => {
    while (pos < end) {
      const c = src.charCodeAt(pos);
      if (c === 0x20 || c === 0x09) pos += 1;
      else if (c === 0x0a) {
        line += 1;
        pos += 1;
      } else if (c === 0x0d) {
        if (src.charCodeAt(pos + 1) !== 0x0a) line += 1;
        pos += 1;
      } else if (jsonc && c === 0x2f) {
        const next = src.charCodeAt(pos + 1);
        if (next === 0x2f) {
          pos += 2;
          while (pos < end && src.charCodeAt(pos) !== 0x0a && src.charCodeAt(pos) !== 0x0d) pos += 1;
        } else if (next === 0x2a) {
          pos += 2;
          let closed = false;
          while (pos < end) {
            const d = src.charCodeAt(pos);
            if (d === 0x2a && src.charCodeAt(pos + 1) === 0x2f) {
              pos += 2;
              closed = true;
              break;
            }
            if (d === 0x0a) line += 1;
            else if (d === 0x0d && src.charCodeAt(pos + 1) !== 0x0a) line += 1;
            pos += 1;
          }
          if (!closed) return false;
        } else return true;
      } else return true;
    }
    return true;
  };

  /** Parse the string at `pos` (an opening quote); null when it is malformed. */
  const readString = (): string | null => {
    pos += 1;
    let start = pos;
    let out = "";
    while (pos < end) {
      const c = src.charCodeAt(pos);
      if (c === 0x22) {
        out += src.slice(start, pos);
        pos += 1;
        return out;
      }
      if (c < 0x20) return null;
      if (c === 0x5c) {
        out += src.slice(start, pos);
        const e = src[pos + 1];
        pos += 2;
        if (e === '"' || e === "\\" || e === "/") out += e;
        else if (e === "b") out += "\b";
        else if (e === "f") out += "\f";
        else if (e === "n") out += "\n";
        else if (e === "r") out += "\r";
        else if (e === "t") out += "\t";
        else if (e === "u") {
          const hex = src.slice(pos, pos + 4);
          if (!HEX.test(hex)) return null;
          out += String.fromCharCode(Number.parseInt(hex, 16));
          pos += 4;
        } else return null;
        start = pos;
      } else pos += 1;
    }
    return null;
  };

  /** Hand a finished value to its container (or make it the root). */
  const complete = (value: JsonValue): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) root = value;
    else if (top.kind === "array") top.items.push(value);
    else {
      if (top.members.has(top.key)) duplicates.push({ reason: "duplicate-key", line: top.keyLine });
      top.members.set(top.key, { keyLine: top.keyLine, value });
    }
  };

  let mode: Mode = "value";
  while (root === undefined) {
    if (!skip()) return notJson();
    if (pos >= end) return notJson();
    const ch = src[pos] as string;

    if (mode === "objectFirst") {
      if (ch === "}") {
        const frame = stack.pop() as Frame & { kind: "object" };
        pos += 1;
        complete({ type: "object", members: frame.members, line: frame.line });
        mode = "after";
        continue;
      }
      mode = "key";
    }
    if (mode === "arrayFirst") {
      if (ch === "]") {
        const frame = stack.pop() as Frame & { kind: "array" };
        pos += 1;
        complete({ type: "array", items: frame.items, line: frame.line });
        mode = "after";
        continue;
      }
      mode = "value";
    }

    if (mode === "key") {
      if (ch !== '"') return notJson();
      const keyLine = line;
      const key = readString();
      if (key === null) return notJson();
      if (!skip() || src[pos] !== ":") return notJson();
      pos += 1;
      const top = stack[stack.length - 1] as Frame & { kind: "object" };
      top.key = key;
      top.keyLine = keyLine;
      mode = "value";
      continue;
    }

    if (mode === "after") {
      const top = stack[stack.length - 1];
      if (top === undefined) return notJson();
      const closer = top.kind === "array" ? "]" : "}";
      if (ch === closer) {
        stack.pop();
        pos += 1;
        complete(
          top.kind === "array"
            ? { type: "array", items: top.items, line: top.line }
            : { type: "object", members: top.members, line: top.line },
        );
        continue;
      }
      if (ch !== ",") return notJson();
      pos += 1;
      if (jsonc) {
        // One trailing comma before the closer is accepted.
        if (!skip()) return notJson();
        if (src[pos] === closer) {
          stack.pop();
          pos += 1;
          complete(
            top.kind === "array"
              ? { type: "array", items: top.items, line: top.line }
              : { type: "object", members: top.members, line: top.line },
          );
          continue;
        }
      }
      mode = top.kind === "array" ? "value" : "key";
      continue;
    }

    // mode === "value"
    const at = line;
    if (ch === "{" || ch === "[") {
      if (stack.length >= MAX_DEPTH) return { ok: false, reason: "too-deep" };
      pos += 1;
      if (ch === "[") {
        stack.push({ kind: "array", items: [], line: at });
        mode = "arrayFirst";
      } else {
        stack.push({ kind: "object", members: new Map(), line: at, key: "", keyLine: at });
        mode = "objectFirst";
      }
      continue;
    }
    if (ch === '"') {
      const value = readString();
      if (value === null) return notJson();
      complete({ type: "string", value, line: at });
    } else if (ch === "-" || (ch >= "0" && ch <= "9")) {
      NUMBER.lastIndex = pos;
      const match = NUMBER.exec(src);
      if (match === null) return notJson();
      pos += match[0].length;
      complete({ type: "number", value: Number(match[0]), line: at });
    } else if (src.startsWith("true", pos)) {
      pos += 4;
      complete({ type: "boolean", value: true, line: at });
    } else if (src.startsWith("false", pos)) {
      pos += 5;
      complete({ type: "boolean", value: false, line: at });
    } else if (src.startsWith("null", pos)) {
      pos += 4;
      complete({ type: "null", line: at });
    } else return notJson();
    mode = "after";
  }

  if (!skip()) return notJson();
  if (pos < end) return notJson();
  return { ok: true, value: root, duplicates };
}
