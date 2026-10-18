import { COVERAGE_FORMAT_SELECTIONS, type CoverageFormatSelection } from "./coverage/types.js";
import { hasGlobSyntax } from "./glob.js";
import { isAbsolutePath } from "./paths.js";
import { AGENT_TOOLS, type AgentTool } from "./setup/summary.js";

/** Shape of `.pharn/ci.yml`. Every field is optional; CLI/Action inputs override it. */
export interface PharnConfig {
  coverage?: {
    /**
     * Coverage report path or glob, or a list of them. A string stays a string; entries with glob syntax are
     * validated and normalized, literal paths are kept as written.
     */
    file?: string | string[];
    format?: CoverageFormatSelection;
    threshold?: number;
    /** Glob patterns of changed files left out of diff coverage (validated and normalized). */
    exclude?: string[];
    /**
     * Normalized repo-relative directory that relative coverage paths start from (package-relative
     * coverage in a monorepo). `.` is the repo root.
     */
    root?: string;
  };
  setup?: {
    /** When true, a repo with no agent setup files fails the check. */
    require?: boolean;
    /** Agent tools the report names when no setup file configures them (validated against the fixed tool list). */
    expect?: AgentTool[];
  };
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

type Scalar = string | number | boolean | null;
interface YamlMap {
  [key: string]: Scalar | Scalar[] | YamlMap;
}

const DOUBLE_QUOTED = /^"(?:[^"\\]|\\.)*"$/;
const SINGLE_QUOTED = /^'(?:[^']|'')*'$/;

/**
 * Parse and validate `.pharn/ci.yml`.
 *
 * Supports the YAML subset the config needs — nested block mappings, comments,
 * quoted/plain strings, numbers, booleans, null — and rejects anything else
 * with a clear error, naming the supported alternative, instead of guessing. A
 * list is read only as the value of `coverage.exclude`, `coverage.file` or `setup.expect`: a block
 * list (`- item` lines) or a one-line flow list of scalars (`[a, "b"]`). Avoids a
 * YAML dependency.
 */
export function parseConfig(text: string): PharnConfig {
  return validateConfig(parseYamlSubset(text));
}

export function parseYamlSubset(text: string): YamlMap {
  const root: YamlMap = {};
  // Stack of open mappings with the indent of their keys.
  const stack: Array<{ indent: number; map: YamlMap }> = [{ indent: 0, map: root }];
  let pendingKey: { map: YamlMap; key: string; indent: number; line: number } | null = null;
  // The block list currently being read (only ever the value of coverage.exclude, coverage.file or setup.expect).
  let list: { indent: number; items: Scalar[] } | null = null;

  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    // trimEnd, not /\s+$/: the regex is quadratic on a long run of inner whitespace, and the
    // config file comes from the PR.
    const raw = stripComment(lines[i] as string).trimEnd();
    if (raw.trim() === "") continue;
    if (raw.trim() === "---" && i === 0) continue;
    if (/^\s*\t/.test(raw)) {
      throw new ConfigError(`line ${lineNo}: tabs are not allowed for indentation; indent with spaces`);
    }

    const indent = raw.length - raw.trimStart().length;
    const content = raw.trimStart();
    if (content.startsWith("- ") || content === "-") {
      if (pendingKey && listAllowed(root, pendingKey.map, pendingKey.key) && indent >= pendingKey.indent) {
        const items: Scalar[] = [];
        pendingKey.map[pendingKey.key] = items;
        list = { indent, items };
        pendingKey = null;
      } else if (list && indent !== list.indent) {
        throw new ConfigError(`line ${lineNo}: unexpected indentation`);
      } else if (!list) {
        throw new ConfigError(`line ${lineNo}: ${LISTS_ONLY_FOR_EXCLUDE}`);
      }
      list.items.push(parseListItem(content, lineNo));
      continue;
    }
    // Any line that is not a list item ends an open list and is read as usual.
    list = null;

    if (pendingKey) {
      if (indent > pendingKey.indent) {
        const child: YamlMap = {};
        pendingKey.map[pendingKey.key] = child;
        stack.push({ indent, map: child });
      } else {
        pendingKey.map[pendingKey.key] = null;
      }
      pendingKey = null;
    }

    while (stack.length > 1 && indent < (stack[stack.length - 1] as { indent: number }).indent) stack.pop();
    const top = stack[stack.length - 1] as { indent: number; map: YamlMap };
    if (indent !== top.indent) throw new ConfigError(`line ${lineNo}: unexpected indentation`);

    const match = /^([A-Za-z0-9_-]+|"[^"]*"|'[^']*')\s*:(?:\s+(.*))?$/.exec(content);
    if (!match) throw new ConfigError(`line ${lineNo}: expected "key: value"`);
    const key = unquoteScalarKey(match[1] as string);
    if (Object.hasOwn(top.map, key)) throw new ConfigError(`line ${lineNo}: duplicate key "${key}"`);
    const value = match[2];
    if (value === undefined || value === "") {
      pendingKey = { map: top.map, key, indent, line: lineNo };
    } else if (value.startsWith("[")) {
      if (!listAllowed(root, top.map, key)) {
        throw new ConfigError(`line ${lineNo}: ${LISTS_ONLY_FOR_EXCLUDE}`);
      }
      top.map[key] = parseFlowList(value, lineNo);
    } else {
      top.map[key] = parseScalar(value, lineNo);
    }
  }
  if (pendingKey) pendingKey.map[pendingKey.key] = null;
  return root;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1] as string))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquoteScalarKey(key: string): string {
  return /^["']/.test(key) ? key.slice(1, -1) : key;
}

/** The keys under `coverage` that may hold a list. */
const LIST_KEYS: ReadonlySet<string> = new Set(["exclude", "file"]);
const LISTS_ONLY_FOR_EXCLUDE =
  "lists are not supported in .pharn/ci.yml except as the value of coverage.exclude, coverage.file or setup.expect";

/** Whether `key` in `map` may hold a list: `coverage.exclude`, `coverage.file` or `setup.expect`. */
function listAllowed(root: YamlMap, map: YamlMap, key: string): boolean {
  if (map === root.coverage) return LIST_KEYS.has(key);
  return map === root.setup && key === "expect";
}
const USE_BLOCK_LIST = 'use a block list, one "- item" line per pattern';

/** One `- item` line of a block list; `content` is the trimmed line, comment already stripped. */
function parseListItem(content: string, lineNo: number): Scalar {
  const item = content.slice(1).trim();
  if (item === "") return null;
  if (item === "-" || item.startsWith("- ")) {
    throw new ConfigError(`line ${lineNo}: nested lists are not supported; ${USE_BLOCK_LIST}`);
  }
  return parseListScalar(item, lineNo);
}

/** A list item: a quoted or plain scalar, never a mapping. */
function parseListScalar(item: string, lineNo: number): Scalar {
  const quoted = DOUBLE_QUOTED.test(item) || SINGLE_QUOTED.test(item);
  if (!quoted && (item.includes(": ") || item.endsWith(":"))) {
    throw new ConfigError(
      `line ${lineNo}: mappings are not supported in a list in .pharn/ci.yml; quote the item if it is a pattern`,
    );
  }
  return parseScalar(item, lineNo);
}

/**
 * A one-line flow list of scalars, `[a, "b, c", 'd']`; `value` starts with "[" and has no comment
 * or trailing whitespace. One pass over the characters, so the cost stays linear on hostile input:
 * commas and brackets inside quotes are text, anything nested or left open is rejected with the fix.
 */
function parseFlowList(value: string, lineNo: number): Scalar[] {
  const items: Scalar[] = [];
  let start = 1;
  let quote: string | null = null;
  // Whether the current item has started: a quote opens a quoted item only as its first character,
  // so an apostrophe inside a plain item stays text.
  let started = false;
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if ((ch === '"' || ch === "'") && !started) {
      quote = ch;
      started = true;
    } else if (ch === "[" || ch === "{" || ch === "}") {
      throw new ConfigError(`line ${lineNo}: nested collections are not supported in a flow list; ${USE_BLOCK_LIST}`);
    } else if (ch === "," || ch === "]") {
      const item = value.slice(start, i).trim();
      // `[]` is an empty list and `[a, b,]` allows one trailing comma; any other empty item is an error.
      const trailing = ch === "]" && (items.length > 0 || value[start - 1] === "[");
      if (item !== "") items.push(parseListScalar(item, lineNo));
      else if (!trailing) throw new ConfigError(`line ${lineNo}: empty item in a flow list; remove the extra comma`);
      start = i + 1;
      started = false;
      if (ch === "]") {
        if (value.slice(i + 1).trim() !== "") {
          throw new ConfigError(`line ${lineNo}: unexpected text after the flow list "]"; ${USE_BLOCK_LIST}`);
        }
        return items;
      }
    } else if (ch !== " ") {
      started = true;
    }
  }
  throw new ConfigError(`line ${lineNo}: a flow list must end with "]" on the same line; ${USE_BLOCK_LIST}`);
}

function parseScalar(value: string, lineNo: number): Scalar {
  const v = value.trim();
  if (DOUBLE_QUOTED.test(v)) {
    try {
      return JSON.parse(v) as string;
    } catch {
      throw new ConfigError(`line ${lineNo}: invalid double-quoted string`);
    }
  }
  if (SINGLE_QUOTED.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^[[{|>&*!%@`]/.test(v)) {
    throw new ConfigError(`line ${lineNo}: unsupported YAML syntax "${v}"; ${unsupportedFix(v[0] as string)}`);
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  // No overlapping quantifiers (the old `\d+\.?\d*` was quadratic on a long run of digits).
  if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(v)) return Number(v);
  return v;
}

/** The supported way to write what an unsupported leading character was trying to say. */
function unsupportedFix(first: string): string {
  if (first === "{") return "write the mapping as indented key: value lines";
  if (first === "[") return USE_BLOCK_LIST;
  if (first === "|" || first === ">") return "write the value on one line";
  return 'quote the value, e.g. "*.gen.ts"';
}

function validateConfig(doc: YamlMap): PharnConfig {
  const config: PharnConfig = {};
  for (const key of Object.keys(doc)) {
    if (key !== "coverage" && key !== "setup") throw new ConfigError(`unknown top-level key "${key}"`);
  }
  const coverage = validateCoverage(doc.coverage);
  if (coverage !== undefined) config.coverage = coverage;
  const setup = validateSetup(doc.setup);
  if (setup !== undefined) config.setup = setup;
  return config;
}

function validateSetup(value: YamlMap[string] | undefined): PharnConfig["setup"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`"setup" must be a mapping`);

  const setup: NonNullable<PharnConfig["setup"]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null) continue;
    switch (key) {
      case "require":
        if (typeof entry !== "boolean") throw new ConfigError(`"setup.require" must be true or false`);
        setup.require = entry;
        break;
      case "expect": {
        if (!Array.isArray(entry)) throw new ConfigError(`"setup.expect" must be a list of agent tool names`);
        const names: string[] = [];
        for (const item of entry) {
          if (typeof item !== "string" || item.trim() === "") {
            throw new ConfigError(`"setup.expect" items must be non-empty strings`);
          }
          names.push(item);
        }
        setup.expect = parseAgentToolNames(names, '"setup.expect" item');
        break;
      }
      default:
        throw new ConfigError(`unknown key "setup.${key}"`);
    }
  }
  return setup;
}

function validateCoverage(cov: YamlMap[string] | undefined): PharnConfig["coverage"] | undefined {
  if (cov === undefined || cov === null) return undefined;
  if (typeof cov !== "object" || Array.isArray(cov)) throw new ConfigError(`"coverage" must be a mapping`);

  const coverage: NonNullable<PharnConfig["coverage"]> = {};
  for (const [key, value] of Object.entries(cov)) {
    if (value === null) continue;
    switch (key) {
      case "file":
        coverage.file = validateCoverageFile(value);
        break;
      case "format":
        if (typeof value !== "string" || !isCoverageFormatSelection(value)) {
          throw new ConfigError(`"coverage.format" must be one of: ${COVERAGE_FORMAT_SELECTIONS.join(", ")}`);
        }
        coverage.format = value;
        break;
      case "threshold":
        coverage.threshold = parseThreshold(value, '"coverage.threshold"');
        break;
      case "exclude": {
        if (!Array.isArray(value)) throw new ConfigError(`"coverage.exclude" must be a list of glob patterns`);
        const patterns: string[] = [];
        for (const item of value) {
          if (typeof item !== "string" || item === "") {
            throw new ConfigError(`"coverage.exclude" items must be non-empty strings`);
          }
          patterns.push(parseExcludePattern(item, '"coverage.exclude" pattern'));
        }
        coverage.exclude = patterns;
        break;
      }
      case "root":
        if (typeof value !== "string" || value === "")
          throw new ConfigError(`"coverage.root" must be a non-empty string`);
        coverage.root = parseCoverageRoot(value, '"coverage.root"');
        break;
      default:
        throw new ConfigError(`unknown key "coverage.${key}"`);
    }
  }
  return coverage;
}

/**
 * `coverage.file`: a non-empty string, or a non-empty list of non-empty strings. Entries with glob syntax
 * are validated with the exclusion rules and stored normalized; literal paths are stored as written.
 */
function validateCoverageFile(value: YamlMap[string]): string | string[] {
  const label = '"coverage.file" pattern';
  const one = (item: string): string => (hasGlobSyntax(item) ? parseExcludePattern(item, label) : item);
  if (Array.isArray(value)) {
    if (value.length === 0) throw new ConfigError(`"coverage.file" must not be an empty list`);
    const entries: string[] = [];
    for (const item of value) {
      if (typeof item !== "string" || item === "") {
        throw new ConfigError(`"coverage.file" items must be non-empty strings`);
      }
      entries.push(one(item));
    }
    return entries;
  }
  if (typeof value !== "string" || value === "") {
    throw new ConfigError(`"coverage.file" must be a non-empty string`);
  }
  return one(value);
}

/**
 * Validate and normalize one exclusion glob (config item, CLI flag or Action input entry): trims it,
 * removes leading `./` and rejects anything outside the matcher's subset. Idempotent. The raw pattern
 * is quoted in the error so the user can find it.
 */
export function parseExcludePattern(pattern: string, label = "exclude pattern"): string {
  let start = 0;
  const trimmed = pattern.trim();
  while (trimmed.startsWith("./", start)) start += 2;
  const p = trimmed.slice(start);

  const reject = (reason: string): never => {
    throw new ConfigError(`${label} "${pattern}" ${reason}`);
  };
  if (p === "") reject("is empty");
  if (p.startsWith("/")) reject('must not start with "/" (patterns are relative to the repository root)');
  if (p.startsWith("!")) reject('must not start with "!" (negation is not supported)');
  if (p.endsWith("/")) reject('must not end with "/" (use "dir/**" for everything under a directory)');
  if (p.includes("//")) reject('must not contain "//"');
  if (p.split("/").includes("..")) reject('must not contain a ".." segment');
  if (p.includes("\\")) reject('must not contain "\\" (use "/" as the separator)');
  for (const ch of ["{", "}", "[", "]"]) {
    if (p.includes(ch)) reject(`must not contain "${ch}" (only *, ** and ? are supported)`);
  }
  return p;
}

/**
 * Validate expected agent tool names (config item, CLI flag, Action input entry or `check()` input): each is
 * trimmed and must be exactly (case-sensitive) a member of the fixed `AGENT_TOOLS` list. Returns the names once
 * each, in first-seen order. The raw name is quoted in the error so the user can find it; no input-derived text
 * reaches a report, only the fixed names.
 */
export function parseAgentToolNames(names: readonly string[], label: string): AgentTool[] {
  const tools: AgentTool[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const tool = AGENT_TOOLS.find((known) => known === name);
    if (tool === undefined) {
      throw new ConfigError(`${label} "${raw}" is not a known agent tool; known tools: ${AGENT_TOOLS.join(", ")}`);
    }
    if (!tools.includes(tool)) tools.push(tool);
  }
  return tools;
}

/**
 * Validate and normalize a coverage root (config value, CLI flag, Action input or `check()` input): a
 * repo-relative directory that relative coverage paths start from. Trims it, strips leading `./` and
 * trailing `/`, collapses duplicate `/`, and returns `.` for the repo root. Rejects an empty value, a
 * backslash, an absolute path, a leading `-` and a `..` segment. Idempotent. The raw value is quoted in
 * the error so the user can find it.
 */
export function parseCoverageRoot(value: string, label: string): string {
  const reject = (reason: string): never => {
    throw new ConfigError(`${label} "${value}" ${reason}`);
  };
  const trimmed = value.trim();
  if (trimmed === "") reject("must not be empty");
  if (trimmed.includes("\\")) reject('must not contain "\\" (use "/" as the separator)');
  if (isAbsolutePath(trimmed)) reject("must be relative to the repository root, not absolute");

  const segments = trimmed.split("/").filter((segment) => segment !== "" && segment !== ".");
  const root = segments.join("/");
  if (root.startsWith("-")) reject('must not start with "-"');
  if (segments.includes("..")) reject('must not contain a ".." segment');
  return root === "" ? "." : root;
}

export function isCoverageFormatSelection(value: string): value is CoverageFormatSelection {
  return (COVERAGE_FORMAT_SELECTIONS as readonly string[]).includes(value);
}

/** Validate a threshold given as a number or a string (CLI flag / Action input). */
export function parseThreshold(value: unknown, label = "threshold"): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new ConfigError(`${label} must be a number between 0 and 100`);
  }
  return n;
}
