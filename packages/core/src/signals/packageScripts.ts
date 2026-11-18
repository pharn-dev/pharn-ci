import { readJson } from "../testConfig/readJson.js";

/**
 * The `scripts` object of a `package.json` text: each script that is a string, and the 1-based line of each member key.
 * Both are `Map`s, so a key named `__proto__`, `constructor` or `toString` is stored and read like any other.
 */
export interface PackageScripts {
  /** The string values of `scripts`, as `JSON.parse` keeps them (the last copy of a duplicated key). */
  values: Map<string, string>;
  /** The line of each key of `scripts` (the last copy of a duplicated key); null when the scan did not find it. */
  lines: Map<string, number | null>;
}

const isJsonSpace = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/**
 * The line of each member key of the last top-level `"scripts"` member whose value is an object, by one linear scan
 * that tracks strings and nesting. Keys are decoded as JSON does, so their names equal `JSON.parse`'s. The text has
 * already been parsed, so it is well-formed JSON.
 */
function scriptKeyLines(text: string): Map<string, number | null> {
  let lines = new Map<string, number | null>();
  const stack: string[] = [];
  let line = 1;
  let afterScriptsKey = false;
  /** The depth of the `scripts` object being read, or 0. */
  let scriptsDepth = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "\n") {
      line++;
      i++;
    } else if (ch === '"') {
      const start = i;
      i++;
      while (i < text.length && text.charAt(i) !== '"') i += text.charAt(i) === "\\" ? 2 : 1;
      i++;
      let after = i;
      while (isJsonSpace(text.charAt(after))) after++;
      const isKey = text.charAt(after) === ":" && stack[stack.length - 1] === "{";
      if (isKey) {
        const name = JSON.parse(text.slice(start, i)) as string;
        if (stack.length === 1 && name === "scripts") {
          lines = new Map();
          afterScriptsKey = true;
        } else if (scriptsDepth > 0 && stack.length === scriptsDepth) {
          lines.set(name, line);
        }
      } else {
        afterScriptsKey = false;
      }
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
      if (afterScriptsKey && ch === "{" && stack.length === 2) scriptsDepth = 2;
      afterScriptsKey = false;
      i++;
    } else if (ch === "}" || ch === "]") {
      if (stack.length === scriptsDepth) scriptsDepth = 0;
      stack.pop();
      i++;
    } else {
      if (ch !== ":" && !isJsonSpace(ch)) afterScriptsKey = false;
      i++;
    }
  }
  return lines;
}

/**
 * Reads the `scripts` of a `package.json` text with `readJson` (its size cap, depth check and BOM handling). A `scripts`
 * that is absent or not an object reads as empty. Null when the text is not read (too large, too deep, not JSON, or not
 * an object), so the caller falls back to diff lines.
 */
export function readPackageScripts(text: string): PackageScripts | null {
  const read = readJson(text);
  if (!read.ok || read.root === null || read.root.type !== "object") return null;
  const scripts = read.root.entries.get("scripts")?.value;
  const values = new Map<string, string>();
  if (scripts === undefined || scripts.type !== "object") return { values, lines: new Map() };
  const found = scriptKeyLines(text);
  const lines = new Map<string, number | null>();
  for (const [key, entry] of scripts.entries) {
    if (entry.value.type === "string") values.set(key, entry.value.value);
    lines.set(key, found.get(key) ?? null);
  }
  return { values, lines };
}
