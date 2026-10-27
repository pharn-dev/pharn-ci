/**
 * The Claude Code permission-rule grammar (E3 item 23, policy settings): parse a rule, normalize a policy entry, and
 * decide whether one rule covers another. It never builds a RegExp from input and never evaluates a command. Coverage
 * is sound, not complete: it says "covers" only when the grammar proves it.
 */

export type PathRoot = "ABS" | "HOME" | "ANCHOR";

/** A Bash token: one code point, or the empty string for a `*` (any run of characters). */
export type BashToken = string;
const STAR: BashToken = "";

export type PermissionRule =
  | { kind: "bare"; tool: string }
  | { kind: "bash"; alternatives: BashToken[][] }
  | {
      kind: "path";
      tool: "Read" | "Edit";
      root: PathRoot;
      dirOnly: boolean;
      segments: string[];
      /** A plain pattern (not dir-only) whose last segment holds no `*` or `?`. */
      literalEnd: boolean;
    }
  | { kind: "webfetch"; host: string; wildcard: boolean }
  | { kind: "mcp"; server: string; tool: string | null }
  | { kind: "other"; tool: string; spec: string };

export type ParsedSettingsRule = { kind: "rule"; rule: PermissionRule } | { kind: "inert" } | { kind: "unknown" };
export type NormalizedPolicyRule = { kind: "rule"; rule: PermissionRule } | { kind: "rejected"; text: string };

const TOOL = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MCP_SERVER = /^[A-Za-z0-9_.-]+$/;
const MCP_TOOL = /^[A-Za-z0-9_-]+$/;
const HOST = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/;
const PATH_FORBIDDEN = /[[\]{}\\]/;
const INERT_TOOLS: ReadonlySet<string> = new Set(["Write", "NotebookEdit", "Glob"]);
const EDITISH: ReadonlySet<string> = new Set(["Edit", "Write", "NotebookEdit"]);
const READISH: ReadonlySet<string> = new Set(["Read", "Glob", "Grep"]);
/** ASCII whitespace: space, tab, LF, CR, FF, VT. */
/** Space, tab, line feed, vertical tab, form feed and carriage return. */
const isAsciiSpace = (code: number) => code === 0x20 || (code >= 0x09 && code <= 0x0d);

/**
 * The text without leading and trailing ASCII whitespace (space, \t, \n, \v, \f, \r). A loop, not a regular expression:
 * a `[ \t…]+$` pattern is quadratic on a long run of whitespace that is not at the end, and the text comes from a pull
 * request's settings file.
 */
export function asciiTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isAsciiSpace(text.charCodeAt(start))) start++;
  while (end > start && isAsciiSpace(text.charCodeAt(end - 1))) end--;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

// ---- parsing ----

function tokens(text: string): BashToken[] {
  const out: BashToken[] = [];
  for (const ch of text) {
    if (ch === "*") {
      if (out[out.length - 1] !== STAR) out.push(STAR);
    } else out.push(ch);
  }
  return out;
}

function parseBash(spec: string): BashToken[][] | null {
  if (spec.endsWith(":*")) {
    const prefix = spec.slice(0, -2);
    if (prefix.includes(":*")) return null;
    return [tokens(prefix), [...tokens(prefix), " ", STAR]];
  }
  if (spec.includes(":*")) return null;
  if (spec.endsWith(" *")) {
    const prefix = spec.slice(0, -2);
    return [tokens(prefix), [...tokens(prefix), " ", STAR]];
  }
  return [tokens(spec)];
}

const collapseGlobstars = (segments: string[]): string[] =>
  segments.filter((segment, i) => !(segment === "**" && segments[i - 1] === "**"));

function parsePath(spec: string, tool: "Read" | "Edit"): PermissionRule | null {
  if (spec.startsWith("!")) return null;
  let rest = spec;
  let root: PathRoot = "ANCHOR";
  let anchored = false;
  if (rest.startsWith("//")) {
    root = "ABS";
    rest = rest.slice(2);
    anchored = true;
  } else if (rest.startsWith("~/")) {
    root = "HOME";
    rest = rest.slice(2);
    anchored = true;
  } else if (rest.startsWith("./")) {
    rest = rest.slice(2);
    anchored = true;
  } else if (rest.startsWith("/")) {
    rest = rest.slice(1);
    anchored = true;
  } else if (rest.slice(0, -1).includes("/")) anchored = true;
  if (!anchored) rest = `**/${rest}`;
  const dirOnly = rest.endsWith("/");
  if (dirOnly) rest = rest.slice(0, -1);
  const raw = rest.split("/");
  for (const segment of raw) {
    if (segment === "" || segment === "." || segment === ".." || PATH_FORBIDDEN.test(segment)) return null;
  }
  let segments = collapseGlobstars(
    raw.map((segment) => (segment === "**" ? segment : segment.replace(/\*{2,}/g, "*"))),
  );
  const last = segments[segments.length - 1] as string;
  const literalEnd = !dirOnly && !last.includes("*") && !last.includes("?");
  if (dirOnly) segments = collapseGlobstars([...segments, "**"]);
  if (segments[segments.length - 1] === "**") segments = [...segments, "*"];
  return { kind: "path", tool, root, dirOnly, segments, literalEnd };
}

function parseMcp(tool: string): PermissionRule | null {
  const rest = tool.slice("mcp__".length);
  const at = rest.indexOf("__");
  const server = at === -1 ? rest : rest.slice(0, at);
  if (server === "" || !MCP_SERVER.test(server)) return null;
  if (at === -1) return { kind: "mcp", server, tool: null };
  const name = rest.slice(at + 2);
  if (name === "*") return { kind: "mcp", server, tool: null };
  if (!MCP_TOOL.test(name)) return null;
  return { kind: "mcp", server, tool: name };
}

function parseWebFetch(spec: string): PermissionRule | null {
  if (!spec.startsWith("domain:")) return null;
  let host = spec.slice("domain:".length);
  const wildcard = host.startsWith("*.");
  if (wildcard) host = host.slice(2);
  if (!HOST.test(host)) return null;
  return { kind: "webfetch", host: host.toLowerCase(), wildcard };
}

/** `unknown` for syntax the grammar rejects, `inert` for a settings-side entry that is ignored. */
function parseRule(text: string, policy: boolean): PermissionRule | "unknown" | "inert" {
  const open = text.indexOf("(");
  let tool = text;
  let spec: string | null = null;
  if (open !== -1) {
    if (!text.endsWith(")")) return "unknown";
    tool = text.slice(0, open);
    spec = text.slice(open + 1, -1);
    if (spec === "") return "unknown";
  }
  if (tool.startsWith("mcp__")) return spec !== null ? "unknown" : (parseMcp(tool) ?? "unknown");
  if (!TOOL.test(tool)) return "unknown";
  if (!policy && spec !== null && INERT_TOOLS.has(tool)) return "inert";
  if (policy) {
    if (tool === "Write" || tool === "NotebookEdit") tool = "Edit";
    else if (tool === "Glob") tool = "Read";
  }
  if (spec === null) return { kind: "bare", tool };
  if (tool === "Bash") {
    const alternatives = parseBash(spec);
    return alternatives === null ? "unknown" : { kind: "bash", alternatives };
  }
  if (tool === "Read" || tool === "Edit") return parsePath(spec, tool) ?? "unknown";
  if (tool === "WebFetch") return parseWebFetch(spec) ?? "unknown";
  return { kind: "other", tool, spec };
}

/** A settings-side entry. The allow side (broad) trims ASCII whitespace first; the deny side does not. */
export function parsePermissionRule(text: string, side: "allow" | "deny"): ParsedSettingsRule {
  const parsed = parseRule(side === "allow" ? asciiTrim(text) : text, false);
  if (parsed === "unknown") return { kind: "unknown" };
  if (parsed === "inert") return { kind: "inert" };
  return { kind: "rule", rule: parsed };
}

/** A policy entry (forbidden or required): `Write`, `NotebookEdit` read as `Edit`, `Glob` as `Read`; not trimmed. */
export function normalizePolicyRule(text: string): NormalizedPolicyRule {
  const parsed = parseRule(text, true);
  if (parsed === "unknown" || parsed === "inert") return { kind: "rejected", text };
  return { kind: "rule", rule: parsed };
}

// ---- inclusion ----

/** Does some alternative of `a` match `f`, `f`'s stars opaque and absorbed only by a star of `a`? */
function bashAlternativeMatches(a: readonly BashToken[], f: readonly BashToken[]): boolean {
  let prev = new Uint8Array(f.length + 1);
  prev[0] = 1;
  for (const token of a) {
    const next = new Uint8Array(f.length + 1);
    if (token === STAR) {
      next[0] = prev[0] as number;
      for (let j = 1; j <= f.length; j++) next[j] = (prev[j] as number) | (next[j - 1] as number);
    } else {
      for (let j = 1; j <= f.length; j++) next[j] = (prev[j - 1] as number) & (f[j - 1] === token ? 1 : 0);
    }
    prev = next;
  }
  return prev[f.length] === 1;
}

/** Do the characters of one path segment of `a` cover those of `f` (a's `*` absorbs anything; f's `?` needs a `?` or `*`)? */
function segmentCovers(a: string, f: string): boolean {
  if (a === f) return true;
  const ac = Array.from(a);
  const fc = Array.from(f);
  let prev = new Uint8Array(fc.length + 1);
  prev[0] = 1;
  for (const token of ac) {
    const next = new Uint8Array(fc.length + 1);
    if (token === "*") {
      next[0] = prev[0] as number;
      for (let j = 1; j <= fc.length; j++) next[j] = (prev[j] as number) | (next[j - 1] as number);
    } else if (token === "?") {
      for (let j = 1; j <= fc.length; j++) next[j] = (prev[j - 1] as number) & (fc[j - 1] === "*" ? 0 : 1);
    } else {
      for (let j = 1; j <= fc.length; j++) next[j] = (prev[j - 1] as number) & (fc[j - 1] === token ? 1 : 0);
    }
    prev = next;
  }
  return prev[fc.length] === 1;
}

/** Segment-level inclusion: a's `**` absorbs any run of f's segments, its other segments exactly one non-`**` one. */
function segmentsCover(a: readonly string[], f: readonly string[]): boolean {
  let prev = new Uint8Array(f.length + 1);
  prev[0] = 1;
  for (const segment of a) {
    const next = new Uint8Array(f.length + 1);
    if (segment === "**") {
      next[0] = prev[0] as number;
      for (let j = 1; j <= f.length; j++) next[j] = (prev[j] as number) | (next[j - 1] as number);
    } else {
      for (let j = 1; j <= f.length; j++) {
        const other = f[j - 1] as string;
        next[j] = (prev[j - 1] as number) & (other !== "**" && segmentCovers(segment, other) ? 1 : 0);
      }
    }
    prev = next;
  }
  return prev[f.length] === 1;
}

const toolOf = (rule: PermissionRule): string | null =>
  rule.kind === "bare" || rule.kind === "path" || rule.kind === "other"
    ? rule.tool
    : rule.kind === "bash"
      ? "Bash"
      : rule.kind === "webfetch"
        ? "WebFetch"
        : null;

/**
 * Whether `covering` covers `covered`. `broad` reads the covering side with its widest meaning (bare Write over the Edit
 * family, a plain path as itself and what is inside it, `*.d` over its subdomains, `T(*)` as bare `T`); `narrow` reads it
 * as written. The covered side is always taken at its own literal pattern.
 */
export function coversRule(covering: PermissionRule, covered: PermissionRule, reading: "broad" | "narrow"): boolean {
  const broad = reading === "broad";
  switch (covering.kind) {
    case "bare": {
      const tool = toolOf(covered);
      if (tool === null) return false;
      if (covering.tool === tool) return true;
      if (!broad) return false;
      if (tool === "Edit" && EDITISH.has(covering.tool)) return true;
      return tool === "Read" && READISH.has(covering.tool);
    }
    case "bash":
      return (
        covered.kind === "bash" &&
        covered.alternatives.every((f) => covering.alternatives.some((a) => bashAlternativeMatches(a, f)))
      );
    case "path": {
      if (covered.kind !== "path" || covered.tool !== covering.tool) return false;
      if (covering.root !== covered.root) {
        const universal =
          covering.segments.length === 2 && covering.segments[0] === "**" && covering.segments[1] === "*";
        return covering.root === "ABS" && universal;
      }
      if (segmentsCover(covering.segments, covered.segments)) return true;
      return broad && covering.literalEnd && segmentsCover([...covering.segments, "**", "*"], covered.segments);
    }
    case "webfetch": {
      if (covered.kind !== "webfetch") return false;
      if (covering.host === covered.host && covering.wildcard === covered.wildcard) return true;
      return broad && covering.wildcard && covered.host.endsWith(`.${covering.host}`);
    }
    case "mcp":
      return (
        covered.kind === "mcp" &&
        covering.server === covered.server &&
        (covering.tool === null || covering.tool === covered.tool)
      );
    case "other": {
      if (covered.kind === "other" && covered.tool === covering.tool) {
        return covering.spec === covered.spec || (broad && covering.spec === "*");
      }
      return broad && covering.spec === "*" && covered.kind === "bare" && covered.tool === covering.tool;
    }
  }
}

/** A settings entry parsed once, with the text as its side compares it (the allow side trimmed). */
export interface PreparedEntry {
  text: string;
  parsed: ParsedSettingsRule;
}

/** A policy entry normalized once. */
export interface PreparedPolicyEntry {
  text: string;
  normalized: NormalizedPolicyRule;
}

export function prepareEntry(text: string, side: "allow" | "deny"): PreparedEntry {
  return { text: side === "allow" ? asciiTrim(text) : text, parsed: parsePermissionRule(text, side) };
}

export function preparePolicyEntry(text: string): PreparedPolicyEntry {
  return { text, normalized: normalizePolicyRule(text) };
}

/** `covers` over entries that are already parsed, so a pair costs one comparison. */
export function coversPrepared(a: PreparedEntry, f: PreparedPolicyEntry, reading: "p02" | "p03"): boolean {
  if (f.normalized.kind === "rejected") return a.text === f.text;
  if (a.parsed.kind !== "rule") return false;
  return coversRule(a.parsed.rule, f.normalized.rule, reading === "p02" ? "broad" : "narrow");
}

/** `overlapsForbidden` over entries that are already parsed. */
export function overlapsPrepared(allow: PreparedEntry, forbidden: PreparedPolicyEntry): boolean {
  if (coversPrepared(allow, forbidden, "p02")) return true;
  if (forbidden.normalized.kind !== "rule" || allow.parsed.kind !== "rule") return false;
  return coversRule(forbidden.normalized.rule, allow.parsed.rule, "broad");
}

/** The settings entry `a` (read broad for p02, narrow for p03) against the policy entry `f`. */
export function covers(a: string, f: string, reading: "p02" | "p03"): boolean {
  return coversPrepared(prepareEntry(a, reading === "p02" ? "allow" : "deny"), preparePolicyEntry(f), reading);
}

/** C1: the allow entry is equal to or broader than the forbidden one, or the forbidden one is broader than it. */
export function overlapsForbidden(allow: string, forbidden: string): boolean {
  return overlapsPrepared(prepareEntry(allow, "allow"), preparePolicyEntry(forbidden));
}

/** The compare-budget family key: rules of different families are never compared. */
export function ruleFamily(text: string): string {
  const trimmed = asciiTrim(text);
  const open = trimmed.indexOf("(");
  const tool = open === -1 ? trimmed : trimmed.slice(0, open);
  if (EDITISH.has(tool)) return "Edit";
  if (READISH.has(tool)) return "Read";
  if (tool.startsWith("mcp__")) {
    const rest = tool.slice("mcp__".length);
    const at = rest.indexOf("__");
    return `mcp__${at === -1 ? rest : rest.slice(0, at)}`;
  }
  return tool;
}
