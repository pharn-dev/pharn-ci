import { INSTALLED_SECTIONS } from "./npmLock.js";
import { sourceOfResolved } from "./specs.js";
import type { LockEntry, LockSource, ParsedLockfile } from "./types.js";

/** One key of the block-YAML tree: its scalar value as written (unquoted), its line, and its children. */
export interface YamlNode {
  value: string;
  line: number;
  children: Map<string, YamlNode> | null;
}

/** A scalar without one pair of surrounding quotes: `''` in a single-quoted one is `'`; a double-quoted one is read as JSON. */
export function unquoteScalar(text: string): string {
  const value = text.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value);
      return typeof decoded === "string" ? decoded : value.slice(1, -1);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** The index of the quote that closes the one at `open`, or -1. */
function closingQuote(text: string, open: number): number {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === "\\") i++;
    else if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") i++;
      else return i;
    }
  }
  return -1;
}

/** `key: value` of one line's content (no indent): the key unquoted and the value as written, or null. */
export function splitKey(content: string): { key: string; value: string } | null {
  if (content.startsWith('"') || content.startsWith("'")) {
    const end = closingQuote(content, 0);
    if (end === -1 || content[end + 1] !== ":") return null;
    return { key: unquoteScalar(content.slice(0, end + 1)), value: content.slice(end + 2).trim() };
  }
  const at = content.indexOf(": ");
  if (at !== -1) return { key: content.slice(0, at), value: content.slice(at + 2).trim() };
  if (content.endsWith(":")) return { key: content.slice(0, -1), value: "" };
  return null;
}

/** A one-line flow mapping `{a: b, c: 'd'}` as children; parts that are not `key: value` are left out. */
function flowMap(text: string, line: number): Map<string, YamlNode> {
  const inner = text.endsWith("}") ? text.slice(1, -1) : text.slice(1);
  const children = new Map<string, YamlNode>();
  let start = 0;
  let quote: string | null = null;
  const take = (end: number) => {
    const part = inner.slice(start, end).trim();
    const colon = part.indexOf(":");
    if (colon > 0) {
      children.set(unquoteScalar(part.slice(0, colon)), {
        value: unquoteScalar(part.slice(colon + 1)),
        line,
        children: null,
      });
    }
  };
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ",") {
      take(i);
      start = i + 1;
    }
  }
  take(inner.length);
  return children;
}

/**
 * The block mappings of a YAML file as a tree, by indentation: enough of YAML for pnpm-lock.yaml and yarn's berry
 * lockfile. Comment lines and list items are skipped; a one-line flow mapping becomes children; any other value is a
 * scalar. One pass, an explicit stack, linear in the text.
 */
export function parseYamlTree(text: string): YamlNode {
  const root: YamlNode = { value: "", line: 0, children: new Map() };
  const stack: Array<{ indent: number; node: YamlNode }> = [{ indent: -1, node: root }];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    let indent = 0;
    while (indent < line.length && line[indent] === " ") indent++;
    const content = line.slice(indent).trimEnd();
    if (content === "" || content.startsWith("#") || content === "-" || content.startsWith("- ")) continue;
    const pair = splitKey(content);
    if (pair === null) continue;
    while (stack.length > 1 && (stack[stack.length - 1] as { indent: number }).indent >= indent) stack.pop();
    const parent = (stack[stack.length - 1] as { node: YamlNode }).node;
    if (parent.children === null) parent.children = new Map();
    const node: YamlNode = {
      value: pair.value.startsWith("{") ? "" : unquoteScalar(pair.value),
      line: i + 1,
      children: pair.value.startsWith("{") ? flowMap(pair.value, i + 1) : null,
    };
    if (!parent.children.has(pair.key)) parent.children.set(pair.key, node);
    stack.push({ indent, node });
  }
  return root;
}

/** name → specifier of an importer's installed sections (v6 and later: `name: {specifier, version}`; v5: `specifiers`). */
function importerSpecs(node: Map<string, YamlNode>): Map<string, string> {
  const specs = new Map<string, string>();
  const legacy = node.get("specifiers")?.children ?? null;
  for (const section of INSTALLED_SECTIONS) {
    const deps = node.get(section)?.children;
    if (deps === undefined || deps === null) continue;
    for (const [name, dep] of deps) {
      const spec = dep.children?.get("specifier")?.value ?? legacy?.get(name)?.value;
      if (spec !== undefined) specs.set(name, spec);
    }
  }
  return specs;
}

/** The name and version of a pnpm package key: `/name@1.0.0(peer)` (v6), `name@1.0.0` (v9) or `/name/1.0.0_peer` (v5). */
export function pnpmKeyParts(key: string): { name: string | null; version: string | null } {
  let text = key.startsWith("/") ? key.slice(1) : key;
  const paren = text.indexOf("(");
  if (paren !== -1) text = text.slice(0, paren);
  const at = text.indexOf("@", 1);
  if (at !== -1) return { name: text.slice(0, at), version: text.slice(at + 1) };
  const slash = text.lastIndexOf("/");
  if (slash <= 0) return { name: text === "" ? null : text, version: null };
  const version = text.slice(slash + 1);
  const underscore = version.indexOf("_");
  return { name: text.slice(0, slash), version: underscore === -1 ? version : version.slice(0, underscore) };
}

function pnpmSource(resolution: Map<string, YamlNode> | null): LockSource {
  if (resolution === null) return { kind: "registry" };
  const tarball = resolution.get("tarball")?.value;
  if (tarball !== undefined) return sourceOfResolved(tarball);
  const type = resolution.get("type")?.value;
  const repo = resolution.get("repo")?.value;
  if (type === "git" || repo !== undefined) return { kind: "git", text: repo ?? "" };
  const directory = resolution.get("directory")?.value;
  if (type === "directory" || directory !== undefined) return { kind: "file", text: directory ?? "" };
  return { kind: "registry" };
}

/**
 * A pnpm-lock.yaml (lockfile versions 5 to 9). Importers come from `importers` (or, for a single project, the
 * top-level sections); entries from `packages`, keyed by their package key, with the integrity and the source of their
 * `resolution`. Null when the text has no `lockfileVersion`.
 */
export function parsePnpmLock(text: string): ParsedLockfile | null {
  const root = parseYamlTree(text).children as Map<string, YamlNode>;
  if (!root.has("lockfileVersion")) return null;
  const importers = new Map<string, Map<string, string>>();
  const listed = root.get("importers")?.children;
  if (listed !== undefined && listed !== null) {
    for (const [dir, node] of listed) importers.set(dir === "." ? "" : dir, importerSpecs(node.children ?? new Map()));
  } else {
    importers.set("", importerSpecs(root));
  }
  const entries: LockEntry[] = [];
  for (const [key, node] of root.get("packages")?.children ?? new Map<string, YamlNode>()) {
    const fields = node.children;
    const parts = pnpmKeyParts(key);
    const resolution = fields?.get("resolution")?.children ?? null;
    entries.push({
      key,
      name: fields?.get("name")?.value ?? parts.name,
      version: fields?.get("version")?.value ?? parts.version,
      integrity: resolution?.get("integrity")?.value ?? null,
      source: pnpmSource(resolution),
      line: node.line,
    });
  }
  return { ecosystem: "npm", format: "pnpm", entries, importers, specs: null, names: null };
}
