import { pnpmKeyParts, splitKey, unquoteScalar } from "./pnpmLock.js";
import { sourceOfResolved } from "./specs.js";
import type { LockSource } from "./types.js";

/**
 * CORE-106 spike: D05 for pnpm-lock.yaml, yarn berry's yarn.lock, poetry.lock and uv.lock from the lockfile's added
 * lines, not from its structure. Every line that names a source key (`tarball`, `resolution`, `resolved`, `url`,
 * `registry`, `git`, `repo`, `directory`, `path`, `source`) is judged by the values of those keys and by any URL on it,
 * however the structure around it is spelled. A key whose value starts on a later line (an empty value, a YAML block
 * scalar, a flow mapping or TOML inline table left open, a TOML multi-line string) carries over to the lines after it.
 * The package name and version come from the nearest package header (and its `name`/`version` fields) of the head file.
 * A finding whose package name and source were already at the merge base is dropped (a moved or reformatted entry).
 */
export type LineLockFormat = "pnpm" | "yarn-berry" | "poetry" | "uv";

type OffSource = Exclude<LockSource, { kind: "registry" } | { kind: "link" }>;

export interface LineSource {
  line: number;
  source: OffSource;
  name: string | null;
  version: string | null;
}

const KEYS = "tarball|resolution|resolved|url|registry|git|repo|directory|path|source";
/** `key: value` or `key = value`, the key at a line start or after `{`, `,`, `[`, `.` or space, optionally quoted. */
const PAIR = new RegExp(
  `(?<![^\\s{,\\[.])(["']?)(${KEYS})\\1[ \\t]*[:=][ \\t]*([{\\[]|"""|'''|"(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s,{}\\[\\]]*)`,
  "g",
);

/** For each index of a line, whether it sits inside a quoted string (1) or not (0): one pass. */
function quoteMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length + 1);
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      mask[i] = 1;
      if (quote === '"' && ch === "\\") {
        i++;
        mask[i] = 1;
      } else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
  }
  return mask;
}
const URL_TOKEN = /(?:[a-z][a-z0-9+.-]*:\/\/|git@|github:|gitlab:|bitbucket:)[^\s"'`,}\]]+/gi;
const BLOCK_SCALAR = /^[|>][+-]?\d*$/;

/** The source of a berry `resolution: "name@protocol:…"`. */
function berrySource(resolution: string): LockSource {
  const at = resolution.indexOf("@", 1);
  let rest = at <= 0 ? resolution : resolution.slice(at + 1);
  // A virtual package wraps the locator after `#`.
  if (rest.startsWith("virtual:")) {
    const hash = rest.indexOf("#");
    rest = hash === -1 ? rest : rest.slice(hash + 1);
  }
  const lower = rest.toLowerCase();
  if (lower.startsWith("npm:") || lower.startsWith("patch:")) return { kind: "registry" };
  if (lower.startsWith("workspace:") || lower.startsWith("portal:") || lower.startsWith("link:"))
    return { kind: "link" };
  return sourceOfResolved(rest);
}

/** The off-registry source a key's value names, or null (a container, an opener, a registry, a link, an allowed URL). */
function offSource(format: LineLockFormat, key: string, value: string, gitType = false): OffSource | null {
  if (value.trim() === '"""' || value.trim() === "'''") return null;
  const text = unquoteScalar(value);
  if (text === "" || BLOCK_SCALAR.test(text)) return null;
  if (text.startsWith("{") || text.startsWith("[") || text.startsWith("*") || text.startsWith("&")) return null;
  let source: LockSource;
  switch (key) {
    case "source":
      return null;
    case "path":
      // Only uv writes a `path` source; pnpm's `patchedDependencies` has a `path` that is no source.
      if (format !== "uv") return null;
      source = { kind: "file", text };
      break;
    case "url":
      source = gitType ? { kind: "git", text } : sourceOfResolved(text);
      break;
    case "resolution":
      source = format === "yarn-berry" ? berrySource(text) : sourceOfResolved(text);
      break;
    case "git":
    case "repo":
      source = { kind: "git", text };
      break;
    case "directory":
      source = { kind: "file", text };
      break;
    default:
      source = sourceOfResolved(text);
  }
  if (source.kind === "registry" || source.kind === "link") return null;
  if (source.kind === "url" && source.allowed) return null;
  return source;
}

/** The net count of `{`/`[` over `}`/`]` outside quotes. */
function bracketDepth(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (const ch of text) {
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return depth;
}

interface Block {
  name: string | null;
  version: string | null;
  /** poetry: a `type = "git"` seen in the block, so its `url` is a git repository. */
  git?: boolean;
}

const POETRY_GIT_TYPE = /(?:^|[\s{,.])type\s*=\s*["']git["']/;

/** A source key whose value goes on past its line. */
interface Carry {
  key: string;
  indent: number;
  depth: number;
  quote: string | null;
}

interface Finding {
  line: number;
  source: OffSource;
  block: Block | null;
  anchor: string | null;
}

/** Every off-registry source on the judged lines of a lockfile, with the package block it sits in. */
function scan(format: LineLockFormat, text: string, judgedLines: ReadonlySet<number> | "all"): Finding[] {
  const yaml = format === "pnpm" || format === "yarn-berry";
  const lines = text.split("\n");
  const found: Finding[] = [];
  let section = "";
  let block: Block | null = null;
  let carry: Carry | null = null;
  const aliasUse = new Map<string, Block>();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    let indent = 0;
    while (indent < line.length && (line[indent] === " " || line[indent] === "\t")) indent++;
    const content = line.slice(indent).trimEnd();
    const judged = judgedLines === "all" || judgedLines.has(i + 1);

    // A YAML key carried over ends at the first line not indented below it, once its brackets are closed.
    if (carry !== null && content !== "" && yaml && carry.depth <= 0 && indent <= carry.indent) carry = null;
    if (content === "") continue;
    if (content.startsWith("#") && (carry === null || carry.quote === null)) continue;

    // Package headers and their name and version fields.
    if (yaml) {
      if (indent === 0) {
        if (format === "pnpm") {
          section = splitKey(content)?.key ?? "";
          block = null;
        } else if (content.startsWith("__metadata")) {
          block = null;
        } else {
          const header = (content.endsWith(":") ? content.slice(0, -1) : content).split(",")[0] ?? "";
          const spec = header.trim().replace(/^"/, "").replace(/"$/, "").trim();
          const at = spec.indexOf("@", 1);
          block = { name: at <= 0 ? null : spec.slice(0, at), version: null };
        }
      } else if (format === "pnpm" && indent === 2 && (section === "packages" || section === "snapshots")) {
        const pair = splitKey(content);
        if (pair !== null) block = { ...pnpmKeyParts(pair.key) };
      } else if (block !== null && indent === (format === "pnpm" ? 4 : 2)) {
        const pair = splitKey(content);
        if (pair?.key === "name") block.name = unquoteScalar(pair.value);
        if (pair?.key === "version") block.version = unquoteScalar(pair.value);
      }
    } else if (carry === null && content.startsWith("[")) {
      const table = content.replace(/\s/g, "");
      if (table === "[[package]]") block = { name: null, version: null };
      else if (!table.startsWith("[package.")) block = null;
      section = table;
    } else if (carry === null && block !== null && section === "[[package]]") {
      const m = /^(name|version)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(content);
      if (m !== null) block[m[1] as "name" | "version"] = unquoteScalar(m[2] as string);
    }

    // Findings on this line: the values of its source keys, then any other URL on it. A trailing comment is no source.
    const inString = (carry as Carry | null)?.quote != null;
    const body: string = inString ? content : withoutComment(content, yaml);
    const consumed: Array<[number, number]> = [];
    let lastOpen: { key: string; at: number; value: string } | null = null;
    const mask = quoteMask(body);
    const pairs: RegExpExecArray[] = [...body.matchAll(PAIR)].filter((m) => mask[m.index ?? 0] === 0);
    const onKeyLine = pairs.length > 0;
    if (format === "poetry" && block !== null && POETRY_GIT_TYPE.test(body)) block.git = true;
    const gitType = block?.git === true;
    // Name recovery: an inline `name = "…"` on the line (uv's requires-dist, dependency refs), a YAML anchor's alias.
    const inline = yaml ? null : /(?<![^\s{,])name\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(body);
    const owner: Block | null =
      inline !== null && inline.index > 0 ? { name: unquoteScalar(inline[1] as string), version: null } : block;
    const anchor = yaml ? (/(?<![^\s{,:])&([\w.-]+)/.exec(body)?.[1] ?? null) : null;
    if (yaml && block !== null)
      for (const m of body.matchAll(/(?<![^\s{,:])\*([\w.-]+)/g)) aliasUse.set(m[1] as string, block);
    const push = (source: OffSource) => found.push({ line: i + 1, source, block: owner, anchor });
    for (const m of pairs) {
      const key = m[2] as string;
      const value = m[3] as string;
      const end = (m.index ?? 0) + m[0].length;
      consumed.push([end - value.length, end]);
      const source = offSource(format, key, value, gitType);
      if (source !== null && judged) push(source);
      const v = value.trim();
      if (v === "" || BLOCK_SCALAR.test(v) || v === '"""' || v === "'''" || v.startsWith("{") || v.startsWith("[")) {
        lastOpen = { key, at: m.index ?? 0, value: v };
      }
    }
    if ((onKeyLine || carry !== null) && judged) {
      // A URL inside a value a key already judged is skipped; spans and tokens both ascend, so one walk.
      let span = 0;
      for (const m of body.matchAll(URL_TOKEN)) {
        const token = m[0];
        const at = m.index ?? 0;
        while (span < consumed.length && (consumed[span] as [number, number])[1] <= at) span++;
        const inside = consumed[span];
        if (inside !== undefined && inside[0] <= at && at + token.length <= inside[1]) continue;
        const key = carry?.key ?? "url";
        const source = offSource(format, key === "source" || key === "resolution" ? "url" : key, token, gitType);
        if (source !== null) push(source);
      }
    }

    // Carry a key whose value goes on past this line.
    if (carry !== null) {
      carry.depth += bracketDepth(body);
      if (carry.quote !== null && body.includes(carry.quote)) carry.quote = null;
      if (!yaml && carry.depth <= 0 && carry.quote === null) carry = null;
    } else if (lastOpen !== null) {
      const depth = bracketDepth(body.slice(lastOpen.at));
      const quote = lastOpen.value === '"""' || lastOpen.value === "'''" ? lastOpen.value : null;
      const empty = lastOpen.value === "" || BLOCK_SCALAR.test(lastOpen.value);
      if (depth > 0 || quote !== null || (yaml && empty)) carry = { key: lastOpen.key, indent, depth, quote };
    }
  }
  // A finding on an anchor's line outside any package belongs to the package that uses the anchor.
  for (const f of found) if (f.block === null && f.anchor !== null) f.block = aliasUse.get(f.anchor) ?? null;
  return found;
}

/** A line without its trailing comment: `#` outside quotes, after whitespace in YAML. */
function withoutComment(text: string, yaml: boolean): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (quote === '"' && ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (!yaml || i === 0 || text[i - 1] === " " || text[i - 1] === "\t")) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

const keyOf = (name: string | null, source: OffSource) => `${name ?? ""}\u0000${source.kind}:${source.text}`;

/**
 * The off-registry sources on the added lines of a head lockfile: one per package name (its first line, with a version
 * from any of its findings), and each one with no package name on its own. `added` holds the 1-based added line numbers
 * ("all" for an added file); `base` is the lockfile at the merge base (null for an added file), whose sources are not
 * reported again for the same package.
 */
export function addedLineSources(
  format: LineLockFormat,
  head: string,
  added: ReadonlySet<number> | "all",
  base: string | null,
): LineSource[] {
  const atBase = new Set(
    base === null ? [] : scan(format, base, "all").map((f) => keyOf(f.block?.name ?? null, f.source)),
  );
  const byName = new Map<string, LineSource>();
  const out: LineSource[] = [];
  for (const f of scan(format, head, added)) {
    const name = f.block?.name ?? null;
    if (atBase.has(keyOf(name, f.source))) continue;
    const version = f.block?.version ?? null;
    if (name !== null) {
      const first = byName.get(name);
      if (first !== undefined) {
        if (first.version === null) first.version = version;
        continue;
      }
    }
    const found: LineSource = { line: f.line, source: f.source, name, version };
    if (name !== null) byName.set(name, found);
    out.push(found);
  }
  return out;
}
