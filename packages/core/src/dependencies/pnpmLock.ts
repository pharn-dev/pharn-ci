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
  if (quote === "'") {
    let i = text.indexOf("'", open + 1);
    while (i !== -1 && text[i + 1] === "'") i = text.indexOf("'", i + 2);
    return i;
  }
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

const isBlank = (ch: string | undefined): boolean => ch === " " || ch === "\t";

/** Where a comment starts in `text` (the `#` of the first ` #` or `\t#`), or the text's length when none does. */
function commentAt(text: string): number {
  const space = text.indexOf(" #");
  const tab = text.indexOf("\t#");
  if (space === -1) return tab === -1 ? text.length : tab + 1;
  return tab === -1 || space < tab ? space + 1 : tab + 1;
}

/** Whether `text` holds a colon followed by a space, a tab or its end (a mapping indicator, in a plain scalar). */
function hasMappingColon(text: string): boolean {
  return text.includes(": ") || text.includes(":\t") || text.endsWith(":");
}

/**
 * `key: value` of one line's content (no indent): the key unquoted and trimmed, and the value as written after the colon
 * and the spaces or tabs that follow it, or null. A plain key ends at the first colon followed by a space, a tab or the
 * end of the line, and may have spaces or tabs before that colon (`resolution :`); a quoted key may too. A `#` after a
 * space or a tab before any such colon starts a comment, so the line has no key.
 */
export function splitKey(content: string): { key: string; value: string } | null {
  if (content.startsWith('"') || content.startsWith("'")) {
    const end = closingQuote(content, 0);
    if (end === -1) return null;
    let colon = end + 1;
    while (isBlank(content[colon])) colon++;
    if (content[colon] !== ":") return null;
    return { key: unquoteScalar(content.slice(0, end + 1)), value: content.slice(colon + 1).trim() };
  }
  const comment = commentAt(content);
  for (let i = content.indexOf(":"); i !== -1 && i < comment; i = content.indexOf(":", i + 1)) {
    if (i + 1 === content.length || isBlank(content[i + 1])) {
      const key = content.slice(0, i).trim();
      return key === "" ? null : { key, value: content.slice(i + 1).trim() };
    }
  }
  return null;
}

/**
 * What starts a YAML anchor (`&`), alias (`*`), tag (`!`) or block scalar (`|`, `>`), or is a reserved or directive
 * indicator (`@`, a backtick, `%`). pnpm writes none of them at the start of a key or a value: a lockfile that has one
 * was edited by hand, and the reader does not resolve it, so the file is unparsable.
 */
const NOT_WRITTEN = new Set(["*", "&", "!", "|", ">", "%", "@", "`"]);

/** Whether a key, as written, is one the reader takes as it is: not empty, no indicator, no `<<` merge key, no `?`. */
function plainKeyAllowed(written: string, key: string): boolean {
  if (written.startsWith("'") || written.startsWith('"')) return true;
  const first = key[0] as string;
  return !NOT_WRITTEN.has(first) && first !== "?" && first !== "{" && first !== "[" && key !== "<<";
}

/** Whether `text` from `from` on is empty or a comment (a `#` after a space or a tab). */
function restIsComment(text: string, from: number): boolean {
  let i = from;
  while (isBlank(text[i])) i++;
  return i === text.length || (i > from && text[i] === "#");
}

const CLOSER: Readonly<Record<string, string>> = { "{": "}", "[": "]" };

/**
 * The flow collection (`{…}` or `[…]`) that `text` starts with, on one line: the index after its closing bracket, with
 * the positions of its top-level commas pushed to `commas`; -1 when it is not closed on the line, its brackets do not
 * match, a quote in it is not closed, a comment cuts it, or a scalar in it starts with an anchor, alias, tag or block
 * scalar indicator. One pass.
 */
function scanFlow(text: string, commas: number[]): number {
  const open: string[] = [];
  let scalarStart = true;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === " " || ch === "\t") continue;
    if (ch === "#" && isBlank(text[i - 1])) return -1;
    if (scalarStart && (ch === "'" || ch === '"')) {
      const end = closingQuote(text, i);
      if (end === -1) return -1;
      i = end;
      scalarStart = false;
      quoted = true;
      continue;
    }
    if (scalarStart && NOT_WRITTEN.has(ch)) return -1;
    const wasQuoted = quoted;
    quoted = false;
    if (ch === "{" || ch === "[") {
      open.push(CLOSER[ch] as string);
      scalarStart = true;
    } else if (ch === "}" || ch === "]") {
      if (open.pop() !== ch) return -1;
      if (open.length === 0) return i + 1;
      scalarStart = false;
    } else if (ch === ",") {
      if (open.length === 1) commas.push(i);
      scalarStart = true;
    } else if (ch === ":" && (wasQuoted || i + 1 === text.length || isBlank(text[i + 1]))) {
      scalarStart = true;
    } else {
      // Skip the rest of a run of characters with no meaning here in one native step (one character class: no
      // backtracking).
      PLAIN_RUN.lastIndex = i + 1;
      if (PLAIN_RUN.test(text)) i = PLAIN_RUN.lastIndex - 1;
      scalarStart = false;
    }
  }
  return -1;
}

/** A run of characters that are not blanks, quotes, comment, flow or mapping indicators. */
const PLAIN_RUN = /[^ \t#'"{}[\],:]+/y;

/** One scalar value as written in a flow mapping (already scanned): unquoted, or a nested collection kept as text. */
function flowScalar(text: string): string | null {
  if (text.startsWith("'") || text.startsWith('"')) {
    return closingQuote(text, 0) === text.length - 1 ? unquoteScalar(text) : null;
  }
  if (text.startsWith("{") || text.startsWith("[")) return text;
  return hasMappingColon(text) ? null : text;
}

/** The parts of a one-line flow mapping (already scanned, `end` past its `}`) as children; null for any part that is not `key: value` or a key given twice. */
function flowMap(text: string, end: number, commas: number[], line: number): Map<string, YamlNode> | null {
  const children = new Map<string, YamlNode>();
  const bounds = [0, ...commas, end - 1];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const part = text.slice((bounds[k] as number) + 1, bounds[k + 1]).trim();
    if (part === "") {
      if (k + 2 === bounds.length && (k > 0 || commas.length === 0)) continue;
      return null;
    }
    const pair = splitKey(part);
    if (pair === null || !plainKeyAllowed(part, pair.key) || children.has(pair.key)) return null;
    const value = flowScalar(pair.value);
    if (value === null) return null;
    children.set(pair.key, { value, line, children: null });
  }
  return children;
}

/** A block value as written after its key: `closed` when it is a scalar or a flow collection (nothing may nest under it). */
type BlockValue = { value: string; children: Map<string, YamlNode> | null; closed: boolean };

/**
 * A value as written after `key:` on a block line, comment cut off: empty, a quoted scalar, a one-line flow mapping (as
 * children), a one-line flow sequence (as text) or a plain scalar. Null for what pnpm never writes and the reader cannot
 * read: an anchor, alias, tag or block scalar, a quote or a flow collection not closed on the line, text after a closing
 * quote or bracket, a `: ` inside a plain scalar.
 */
function blockValue(text: string, line: number): BlockValue | null {
  if (text === "" || text.startsWith("#")) return { value: "", children: null, closed: false };
  const first = text[0] as string;
  if (NOT_WRITTEN.has(first)) return null;
  if (first === "'" || first === '"') {
    const end = closingQuote(text, 0);
    if (end === -1 || !restIsComment(text, end + 1)) return null;
    return { value: unquoteScalar(text.slice(0, end + 1)), children: null, closed: true };
  }
  if (first === "{" || first === "[") {
    const commas: number[] = [];
    const end = scanFlow(text, commas);
    if (end === -1 || !restIsComment(text, end)) return null;
    if (first === "[") return { value: text.slice(0, end), children: null, closed: true };
    const children = flowMap(text, end, commas, line);
    return children === null ? null : { value: "", children, closed: true };
  }
  const value = text.slice(0, commentAt(text)).trimEnd();
  return hasMappingColon(value) ? null : { value, children: null, closed: true };
}

/**
 * One YAML document as a tree of its block mappings, by indentation: the subset pnpm writes in pnpm-lock.yaml (block
 * mappings, one-line flow mappings and sequences, block sequences, plain and quoted scalars, comments), read the way
 * js-yaml (which pnpm loads the lockfile with) reads it. A block sequence's items are read for their shape and kept out
 * of the tree; a one-line flow mapping becomes children. Null for anything else, so it is never guessed at: an anchor,
 * alias, tag, block scalar or merge key, an explicit `?` key that is not a scalar on one line followed by its `:` line
 * (js-yaml writes one for a key over 1024 characters), a line that is no `key: value` (a value continued on the next
 * line), a flow collection across lines, a key given twice in one mapping, a tab in the indentation or a lone CR, a
 * child under a scalar, a directive, or a document marker after the first line with content. One pass, an explicit
 * stack, linear in the text.
 */
export function parseYamlTree(text: string, lineOffset = 0): YamlNode | null {
  const root: YamlNode = { value: "", line: 0, children: new Map() };
  const stack: Array<{ indent: number; node: YamlNode; closed: boolean }> = [{ indent: -1, node: root, closed: false }];
  /** The open node a line at `indent` goes under, or null when that node is a scalar or a flow collection. */
  const parentAt = (indent: number) => {
    while (stack.length > 1 && (stack[stack.length - 1] as { indent: number }).indent >= indent) stack.pop();
    const top = stack[stack.length - 1] as { node: YamlNode; closed: boolean };
    return top.closed ? null : top.node;
  };
  const lines = text.split("\n");
  let started = false;
  let explicit: { key: string; indent: number; line: number } | null = null;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n] as string;
    const i = n + lineOffset;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    // js-yaml breaks a line at a lone CR too; pnpm never writes one.
    if (line.includes("\r")) return null;
    let indent = 0;
    while (indent < line.length && line[indent] === " ") indent++;
    const content = line.slice(indent).trimEnd();
    if (content === "" || content.startsWith("#")) continue;
    if (content.startsWith("\t")) return null;
    if (indent === 0 && content === "---" && !started) {
      started = true;
      continue;
    }
    started = true;
    // Block sequence items (`- a`, `- - a`, `- key: value`): each opens an anonymous node the lines under it belong to.
    let at = 0;
    let itemIndent = indent;
    while (content[at] === "-" && (at + 1 === content.length || content[at + 1] === " ")) {
      if (parentAt(itemIndent) === null) return null;
      stack.push({ indent: itemIndent, node: { value: "", line: i + 1, children: null }, closed: false });
      let next = at + 1;
      while (content[next] === " ") next++;
      itemIndent += next - at;
      at = next;
    }
    if (at === content.length) continue;
    let rest = at === 0 ? content : content.slice(at);
    if (rest.startsWith("\t") || rest.startsWith("-\t")) return null;
    if (explicit !== null) {
      // The `:` line of an explicit key, at its indent: the value follows, or a mapping whose first key is on this line.
      if (itemIndent !== explicit.indent || !(rest === ":" || rest.startsWith(": "))) return null;
      const parent = parentAt(itemIndent);
      if (parent === null) return null;
      if (parent.children === null) parent.children = new Map();
      if (parent.children.has(explicit.key)) return null;
      const node: YamlNode = { value: "", line: explicit.line, children: null };
      parent.children.set(explicit.key, node);
      explicit = null;
      let next = 1;
      while (rest[next] === " ") next++;
      const after = rest.slice(next);
      const inner = after === "" ? null : splitKey(after);
      if (inner === null) {
        const value = blockValue(after, i + 1);
        if (value === null) return null;
        node.value = value.value;
        node.children = value.children;
        stack.push({ indent: itemIndent, node, closed: value.closed });
        continue;
      }
      stack.push({ indent: itemIndent, node, closed: false });
      itemIndent += next;
      rest = after;
    } else if (rest === "?" || rest.startsWith("? ")) {
      // An explicit key (js-yaml writes one for a key over 1024 characters): a scalar, its value on the next line.
      const written = rest.slice(1).trim();
      const key = written.startsWith("[") ? null : blockValue(written, i + 1);
      if (key === null || !key.closed || key.children !== null) return null;
      explicit = { key: key.value, indent: itemIndent, line: i + 1 };
      continue;
    }
    const pair = splitKey(rest);
    if (pair === null) {
      if (at === 0) return null;
      // A scalar item: its shape is checked, and it is closed to anything nested under it.
      if (blockValue(rest, i + 1)?.closed !== true) return null;
      (stack[stack.length - 1] as { closed: boolean }).closed = true;
      continue;
    }
    if (!plainKeyAllowed(rest, pair.key)) return null;
    const parent = parentAt(itemIndent);
    if (parent === null) return null;
    if (parent.children === null) parent.children = new Map();
    if (parent.children.has(pair.key)) return null;
    const value = blockValue(pair.value, i + 1);
    if (value === null) return null;
    const node: YamlNode = { value: value.value, line: i + 1, children: value.children };
    parent.children.set(pair.key, node);
    stack.push({ indent: itemIndent, node, closed: value.closed });
  }
  return explicit === null ? root : null;
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

/** The resolution keys `pnpmSource` takes a source from. */
const SOURCE_KEYS = ["tarball", "type", "repo", "directory"] as const;

/**
 * A package's `resolution` as the reader can judge it: its fields (null when there is none), or undefined when it is
 * something the reader cannot read: a scalar or nothing in place of a mapping, or a source key whose value is not a
 * plain string (empty, a nested collection, or a mapping under it).
 */
function readableResolution(node: YamlNode | undefined): Map<string, YamlNode> | null | undefined {
  if (node === undefined) return null;
  if (node.children === null) return undefined;
  for (const key of SOURCE_KEYS) {
    const field = node.children.get(key);
    if (field === undefined) continue;
    if (field.children !== null || field.value === "" || field.value.startsWith("{") || field.value.startsWith("["))
      return undefined;
  }
  return node.children;
}

/**
 * The YAML documents pnpm reads from the text: pnpm (10 and later) strips a first `---\n…\n---\n` document (the env
 * lockfile of config dependencies) and loads the rest as the lockfile. Both are read here, so neither can hide an entry.
 */
function pnpmDocuments(text: string): Array<{ text: string; lineOffset: number }> {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.startsWith("---\n")) {
    const separator = body.indexOf("\n---\n", 4);
    if (separator !== -1) {
      const env = body.slice(4, separator + 1);
      let lines = 0;
      for (let i = 0; i < env.length; i++) if (env[i] === "\n") lines++;
      return [
        { text: env, lineOffset: 1 },
        { text: body.slice(separator + 5), lineOffset: lines + 2 },
      ];
    }
  }
  return [{ text: body, lineOffset: 0 }];
}

/**
 * A pnpm-lock.yaml (lockfile versions 5 to 9). Importers come from `importers` (or, for a single project, the
 * top-level sections); entries from `packages`, keyed by their package key, with the integrity and the source of their
 * `resolution`. With an env document first (pnpm 10 and later), both documents' importers and entries are read. Null
 * when the lockfile document has no `lockfileVersion`, when a document is not in the YAML subset pnpm writes
 * (`parseYamlTree`), or when a package's resolution cannot be read (`readableResolution`): an unparsable lockfile is
 * reported unread, never judged on a guess.
 */
export function parsePnpmLock(text: string): ParsedLockfile | null {
  const documents: Array<Map<string, YamlNode>> = [];
  for (const document of pnpmDocuments(text)) {
    const tree = parseYamlTree(document.text, document.lineOffset);
    if (tree === null) return null;
    documents.push(tree.children as Map<string, YamlNode>);
  }
  if (!(documents[documents.length - 1] as Map<string, YamlNode>).has("lockfileVersion")) return null;
  const importers = new Map<string, Map<string, string>>();
  const addImporter = (dir: string, specs: Map<string, string>) => {
    const known = importers.get(dir);
    if (known === undefined) importers.set(dir, specs);
    else for (const [name, spec] of specs) if (!known.has(name)) known.set(name, spec);
  };
  const entries: LockEntry[] = [];
  for (const root of documents) {
    const listed = root.get("importers")?.children;
    if (listed !== undefined && listed !== null) {
      for (const [dir, node] of listed) addImporter(dir === "." ? "" : dir, importerSpecs(node.children ?? new Map()));
    } else {
      addImporter("", importerSpecs(root));
    }
    for (const [key, node] of root.get("packages")?.children ?? new Map<string, YamlNode>()) {
      const fields = node.children;
      const parts = pnpmKeyParts(key);
      const resolution = readableResolution(fields?.get("resolution"));
      if (resolution === undefined) return null;
      entries.push({
        key,
        name: fields?.get("name")?.value ?? parts.name,
        version: fields?.get("version")?.value ?? parts.version,
        integrity: resolution?.get("integrity")?.value ?? null,
        source: pnpmSource(resolution),
        line: node.line,
      });
    }
  }
  return { ecosystem: "npm", format: "pnpm", entries, importers, specs: null, names: null };
}
