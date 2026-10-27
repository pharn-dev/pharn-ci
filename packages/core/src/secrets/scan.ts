import type { AgentSetupInventory, AgentSetupKind } from "../setup/scan.js";
import type { TestSourceFile, TestSourceSide } from "../testSources.js";
import { isEnvReference, isPathValue, isUrlValue, type KeyValue, secretKeyValues } from "./keys.js";
import { findSecretSpansWith, type SecretId } from "./spans.js";

/**
 * The agent setup kinds whose files are machine-readable config and are read for committed secrets. The Markdown kinds
 * (instructions, rules, skills, commands) are never read by the secret scan.
 */
export const SECRET_SCAN_KINDS: readonly AgentSetupKind[] = [
  "mcp-config",
  "cursor-mcp",
  "vscode-mcp",
  "claude-settings",
  "claude-settings-local",
  "codex-config",
  "gemini-settings",
  "opencode-config",
  "aider-config",
  "claude-hook",
  "continue-rules",
];

const SCAN_KINDS: ReadonlySet<AgentSetupKind> = new Set(SECRET_SCAN_KINDS);
const CONTINUE_CONFIG_EXTENSIONS: readonly string[] = [".json", ".yaml", ".yml"];

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The paths of the inventory's files whose kind is in `SECRET_SCAN_KINDS`, de-duplicated and sorted in code-unit order.
 * Of the `continue-rules` files only `.json`, `.yaml` and `.yml` files count (case-insensitive); no Markdown kind is
 * ever returned.
 */
export function agentConfigSecretPaths(inventory: AgentSetupInventory): string[] {
  const paths = new Set<string>();
  for (const file of inventory.files) {
    if (!SCAN_KINDS.has(file.kind)) continue;
    if (file.kind === "continue-rules") {
      const lower = file.path.toLowerCase();
      if (!CONTINUE_CONFIG_EXTENSIONS.some((extension) => lower.endsWith(extension))) continue;
    }
    paths.add(file.path);
  }
  return [...paths].sort(byCodeUnit);
}

/**
 * The text of the agent config files at HEAD: why they could not be read, or the files read with their text and the
 * files whose text was not kept, each with its reason.
 */
export type AgentConfigSources = TestSourceSide;

/** One finding: the shape (S01 to S10, or S11 for a literal next to env references), the file and the 1-based line. */
export interface AgentConfigSecretFinding {
  id: SecretId | "S11";
  path: string;
  line: number;
}

/** The shortest literal value under a secret-named key that S11 reports. */
const MIN_S11_CHARS = 8;

/** The offsets at which each line of `text` starts. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** The 1-based line of `offset`, by binary search over the line starts. */
function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] as number) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Whether a literal under a secret-named key is a value S11 reports: not a flag, a number, a URL or a path. */
function isLiteralSecret(value: string): boolean {
  if (value.length < MIN_S11_CHARS || isEnvReference(value) || isUrlValue(value) || isPathValue(value)) return false;
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "false") return false;
  return !/^[+-]?\d+(?:\.\d+)?$/.test(value);
}

/** The S11 findings of one file: a literal under a secret-named key, in a file that loads other secrets from the env. */
function literalFindings(pairs: readonly KeyValue[], spans: readonly { start: number; end: number }[]): number[] {
  if (!pairs.some((pair) => isEnvReference(pair.value))) return [];
  const offsets: number[] = [];
  for (const pair of pairs) {
    if (!isLiteralSecret(pair.value)) continue;
    if (spans.some((span) => span.start < pair.valueEnd && pair.valueStart < span.end)) continue;
    offsets.push(pair.valueStart);
  }
  return offsets;
}

/**
 * The secrets in the files: S01 to S10 at the line where each span starts, and S11 at the line of each literal value
 * under a secret-named key in a file where another secret-named key holds an environment reference. One finding per
 * (id, path, line), sorted by id, then path, then line, in code-unit order.
 */
export function scanAgentConfigSecrets(files: readonly TestSourceFile[]): AgentConfigSecretFinding[] {
  const found = new Map<string, AgentConfigSecretFinding>();
  for (const file of files) {
    const starts = lineStarts(file.text);
    const pairs = secretKeyValues(file.text);
    const spans = findSecretSpansWith(file.text, pairs);
    const add = (id: SecretId | "S11", offset: number) => {
      const line = lineOf(starts, offset);
      found.set(`${id}\0${file.path}\0${line}`, { id, path: file.path, line });
    };
    for (const span of spans) add(span.id, span.start);
    for (const offset of literalFindings(pairs, spans)) add("S11", offset);
  }
  return [...found.values()].sort((a, b) => byCodeUnit(a.id, b.id) || byCodeUnit(a.path, b.path) || a.line - b.line);
}
