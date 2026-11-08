import { findComment, indentOf, unquote } from "../../signals/yamlLines.js";

/**
 * The facts rule P13 reads from a GitHub Actions workflow, line by line (not a YAML parser): the secrets it references,
 * its `permissions:` blocks at the workflow and job level, its job ids, and whether it names `pull_request_target`. A
 * file whose structure this reader cannot follow (tab indentation, an anchor, alias or merge key, a second document, a
 * root that is not a block mapping, `jobs` or `permissions` written as a flow mapping across lines, or a U+0085,
 * U+2028 or U+2029 anywhere, which a YAML 1.1 parser reads as a line break and this reader does not) gives null, so
 * the rule fails closed. Nothing here returns file text.
 */

/** The fixed words of a workflow widening, in the order they are reported. */
export const WORKFLOW_WIDENINGS = [
  "secrets referenced grew",
  "permissions widened",
  "permissions block removed",
  "pull_request_target trigger added",
] as const;
export type WorkflowWidening = (typeof WORKFLOW_WIDENINGS)[number];

/** A `permissions:` block: a scalar for every scope (`read-all`, `write-all`, or other text), or scope values. */
interface PermissionBlock {
  all: string | null;
  scopes: Map<string, string>;
}

export interface WorkflowFacts {
  /** The secrets referenced: upper-cased names, plus `\u0000inherit` and `\u0000context` for all of them at once. */
  secrets: Set<string>;
  /** The blocks by location: `""` for the workflow, `jobs/<id>` for a job. */
  permissions: Map<string, PermissionBlock>;
  /** The job ids. */
  jobs: Set<string>;
  pullRequestTarget: boolean;
}

/** The token permission scopes GitHub names; `read-all` and `write-all` set every one of them. */
const SCOPES: readonly string[] = [
  "actions",
  "attestations",
  "checks",
  "contents",
  "deployments",
  "discussions",
  "id-token",
  "issues",
  "models",
  "packages",
  "pages",
  "pull-requests",
  "repository-projects",
  "security-events",
  "statuses",
];

const LEVELS: Record<string, number> = { none: 0, read: 1, write: 2 };

/** The text of a line before its comment, without trimming the indent. */
function withoutComment(line: string): string {
  const { start } = findComment(line);
  return start === -1 ? line : line.slice(0, start);
}

/**
 * `key: value` on one line (an optional `- ` before the key), read in full; null when the line is not one. Linear: no
 * two adjacent quantifiers can match the same character (one white-space character after the colon, then the rest of
 * the line as it is, trimmed below), and the tail `[\s\S]*` always reaches the end, so `$` never fails into a retry.
 */
function pairOf(line: string): { key: string; value: string; indent: number } | null {
  const text = withoutComment(line).trim();
  const match = /^(-\s+)?([A-Za-z0-9_.<-]+|"[^"]*"|'[^']*')\s*:(?:\s([\s\S]*))?$/.exec(text);
  if (match === null) return null;
  const rawKey = match[2] as string;
  return {
    key: rawKey.startsWith('"') || rawKey.startsWith("'") ? rawKey.slice(1, -1) : rawKey,
    value: (match[3] ?? "").trim(),
    indent: indentOf(line) + (match[1] === undefined ? 0 : match[1].length),
  };
}

/** The scopes of a one-line flow mapping `{ contents: read, issues: write }`, or null when the text is not one. */
function flowScopes(value: string): Map<string, string> | null {
  if (!value.startsWith("{") || !value.endsWith("}")) return null;
  const scopes = new Map<string, string>();
  const inner = value.slice(1, -1).trim();
  if (inner === "") return scopes;
  for (const part of inner.split(",")) {
    const at = part.indexOf(":");
    if (at === -1) return null;
    scopes.set(unquote(part.slice(0, at)), unquote(part.slice(at + 1)));
  }
  return scopes;
}

const SECRET_NAME = /(?<![\w-])secrets\s*\.\s*([A-Za-z0-9_-]+)/gi;
const SECRET_INDEX = /(?<![\w-])secrets\s*\[\s*(['"])([^'"\r\n]*)\1\s*\]/gi;
const SECRET_CONTEXT = /(?<![\w.-])secrets(?!\s*[.[\w-])/i;
const PULL_REQUEST_TARGET = /(?<![\w-])pull_request_target(?![\w-])/;
/** The characters a YAML 1.1 parser breaks lines at besides CR and LF; this reader splits at CR and LF only. */
const OTHER_LINE_BREAK = /[\x85\u{2028}\u{2029}]/u;

/** The workflow facts of one side, or null when the reader cannot follow the file. */
export function workflowFacts(text: string): WorkflowFacts | null {
  // A line this reader would read as one can be two to GitHub's parser, hiding a key: fail closed.
  if (OTHER_LINE_BREAK.test(text)) return null;
  const facts: WorkflowFacts = {
    secrets: new Set(),
    permissions: new Map(),
    jobs: new Set(),
    pullRequestTarget: false,
  };
  // Secrets are read from the whole text, comments and run scripts included: GitHub expands an expression anywhere.
  for (const match of text.matchAll(SECRET_NAME)) facts.secrets.add((match[1] as string).toUpperCase());
  for (const match of text.matchAll(SECRET_INDEX)) facts.secrets.add((match[2] as string).toUpperCase());
  // Each `${{ … }}` once, with indexOf: an unclosed `${{` ends the scan, so the pass stays linear.
  for (let at = text.indexOf("${{"); at !== -1; ) {
    const end = text.indexOf("}}", at + 3);
    if (end === -1) break;
    if (SECRET_CONTEXT.test(text.slice(at + 3, end))) facts.secrets.add("\u0000context");
    at = text.indexOf("${{", end + 2);
  }

  const lines = text.split(/\r\n|\n|\r/);
  const stack: { indent: number; key: string }[] = [];
  let blockScalar: number | null = null;
  let content = false;
  let open: { location: string; block: PermissionBlock; indent: number } | null = null;
  for (const line of lines) {
    if (blockScalar !== null) {
      if (line.trim() === "" || indentOf(line) > blockScalar) continue;
      blockScalar = null;
    }
    const bare = withoutComment(line);
    if (bare.trim() === "") continue;
    if (/^[ ]*\t/.test(line)) return null;
    const trimmed = bare.trim();
    if (trimmed === "---" || trimmed === "...") {
      if (content) return null;
      continue;
    }
    if (PULL_REQUEST_TARGET.test(bare)) facts.pullRequestTarget = true;
    const pair = pairOf(line);
    if (pair === null) {
      // A root that is not a block mapping, or an alias or anchor as a list item.
      if (!content && indentOf(line) === 0) return null;
      if (/^-\s+[&*!]/.test(trimmed)) return null;
      if (/^-\s+[|>][-+0-9]*$/.test(trimmed)) blockScalar = indentOf(line);
      continue;
    }
    content = true;
    if (pair.key === "<<" || /^[&*!]/.test(pair.value)) return null;
    while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= pair.indent) stack.pop();
    if (open !== null && pair.indent <= open.indent) open = null;
    const path = [...stack.map((entry) => entry.key), pair.key];
    if (open !== null && path.length >= 2 && path[path.length - 2] === "permissions") {
      open.block.scopes.set(pair.key, unquote(pair.value));
      continue;
    }
    if (pair.key === "secrets" && unquote(pair.value) === "inherit") facts.secrets.add("\u0000inherit");
    if (pair.key === "if" && SECRET_CONTEXT.test(pair.value) && !pair.value.includes("${{")) {
      facts.secrets.add("\u0000context");
    }
    const atJob = path.length === 3 && path[0] === "jobs";
    if (path.length === 2 && path[0] === "jobs") facts.jobs.add(pair.key);
    // `jobs` or a job written as a flow mapping hides the job blocks; a `permissions` flow mapping must fit on its line.
    const flow = pair.value.startsWith("{") || pair.value.startsWith("[");
    if (flow && ((path.length === 1 && pair.key === "jobs") || (path.length === 2 && path[0] === "jobs"))) return null;
    if (pair.key === "permissions" && pair.value.startsWith("{") && !pair.value.endsWith("}")) return null;
    if (pair.key === "permissions" && (path.length === 1 || atJob)) {
      const location = path.length === 1 ? "" : `jobs/${path[1]}`;
      const block: PermissionBlock = { all: null, scopes: new Map() };
      facts.permissions.set(location, block);
      if (pair.value === "") {
        open = { location, block, indent: pair.indent };
      } else {
        const scopes = flowScopes(pair.value);
        if (scopes === null) block.all = unquote(pair.value);
        else block.scopes = scopes;
      }
    }
    if (/^[|>][-+0-9]*$/.test(pair.value)) blockScalar = pair.indent;
    else if (pair.value === "") stack.push({ indent: pair.indent, key: pair.key });
  }
  return facts;
}

/** The value a block gives one scope: its own entry, else what `read-all` or `write-all` sets, else `none`. */
function scopeValue(block: PermissionBlock, scope: string): string {
  const own = block.scopes.get(scope);
  if (own !== undefined) return own;
  if (block.all === "read-all") return "read";
  if (block.all === "write-all") return "write";
  if (block.all !== null) return block.all;
  return "none";
}

/**
 * Whether `head` gives any scope more than `base`. A scope's value is compared by level (none < read < write); a value
 * that is not one of the three counts as write on the head and none on the base, unless it is the same text on both.
 * With no base block (the default token permissions apply), a head block widens when it is `read-all`, `write-all`,
 * any other scalar, or gives a scope write or a value that is not a level.
 */
function widens(base: PermissionBlock | null, head: PermissionBlock): boolean {
  if (base === null) {
    if (head.all !== null) return true;
    return [...head.scopes.values()].some((value) => (LEVELS[value] ?? 2) >= 2);
  }
  const scopes = new Set<string>([...base.scopes.keys(), ...head.scopes.keys()]);
  if (base.all !== null || head.all !== null) for (const scope of SCOPES) scopes.add(scope);
  for (const scope of scopes) {
    const before = scopeValue(base, scope);
    const after = scopeValue(head, scope);
    if (before === after) continue;
    if ((LEVELS[after] ?? 2) > (LEVELS[before] ?? 0)) return true;
  }
  return false;
}

/**
 * The widenings of a workflow from base to head (either may be null for a file absent on that side): a secret, or all
 * of them (`secrets: inherit`, the whole `secrets` context), referenced that the base did not reference; a permission
 * scope raised at the workflow or job level, or `read-all` or `write-all` newly appearing, where a job without a block
 * of its own inherits the workflow's; a `permissions:` block removed from a workflow or job the head still has; and a
 * `pull_request_target` trigger added. Null when a present side cannot be read.
 */
export function workflowWidenings(base: string | null, head: string | null): WorkflowWidening[] | null {
  const b = base === null ? null : workflowFacts(base);
  const h = head === null ? null : workflowFacts(head);
  if ((base !== null && b === null) || (head !== null && h === null)) return null;
  const found = new Set<WorkflowWidening>();
  if (h !== null) {
    const before = b?.secrets ?? new Set<string>();
    if ([...h.secrets].some((name) => !before.has(name))) found.add("secrets referenced grew");
    const baseTop = b?.permissions.get("") ?? null;
    const headTop = h.permissions.get("") ?? null;
    if (baseTop !== null && headTop === null) found.add("permissions block removed");
    if (headTop !== null && widens(baseTop, headTop)) found.add("permissions widened");
    for (const job of h.jobs) {
      const location = `jobs/${job}`;
      const baseJob = b?.permissions.get(location) ?? null;
      const headJob = h.permissions.get(location) ?? null;
      if (baseJob !== null && headJob === null) found.add("permissions block removed");
      if (headJob !== null && widens(baseJob ?? baseTop, headJob)) found.add("permissions widened");
    }
    if (h.pullRequestTarget && b?.pullRequestTarget !== true) found.add("pull_request_target trigger added");
  }
  return WORKFLOW_WIDENINGS.filter((word) => found.has(word));
}
