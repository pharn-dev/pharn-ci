import { compileGlob } from "../glob.js";
import { INSTRUCTION_KINDS } from "../setup/instructions.js";
import { type AgentSetupKind, classifySetupPath } from "../setup/scan.js";

/**
 * Where each prompt-injection signal applies, by path only. Every check is a string or glob operation on the
 * repo-relative path: nothing is read.
 */

/** Paths no signal reads by default: test fixtures, test data and test files. */
export const DEFAULT_EXEMPT: readonly string[] = [
  "fixtures/**",
  "**/__fixtures__/**",
  "**/testdata/**",
  "**/*.test.*",
  "**/*.spec.*",
];

/** Paths PI03 also leaves out by default: test directories. */
export const DEFAULT_PI03_EXEMPT: readonly string[] = ["**/test/**"];

/**
 * Locale files: PI03 leaves them out, and PI01 accepts the directional marks (U+200E, U+200F, U+061C) and the soft
 * hyphen in them.
 */
export const LOCALE_PATHS: readonly string[] = [
  "**/locales/**",
  "**/messages/**",
  "**/i18n/**",
  "**/lang/**",
  "**/*.po",
  "**/*.arb",
];

/** The directory names of vendored code; PI05 flags an instruction file added under one of them. */
export const VENDORED_DIRS: readonly string[] = [
  "node_modules",
  "vendor",
  "third_party",
  ".venv",
  "dist",
  "bower_components",
];

/**
 * The agent setup kinds whose files an agent reads as instructions: the Markdown instruction kinds, skills, agents,
 * commands and prompts, and the Claude Code settings files. PI04 reads their added lines and PI05 flags them under a
 * vendored directory.
 */
export const INJECTION_INSTRUCTION_KINDS: readonly AgentSetupKind[] = [
  ...INSTRUCTION_KINDS,
  "claude-skill",
  "claude-agent",
  "claude-command",
  "copilot-agents",
  "copilot-prompts",
  "claude-settings",
  "claude-settings-local",
];

const INSTRUCTION_KIND_SET: ReadonlySet<AgentSetupKind> = new Set(INJECTION_INSTRUCTION_KINDS);

/** A predicate that is true when any of the globs matches the path. */
export function anyGlob(patterns: readonly string[]): (path: string) => boolean {
  const matchers = patterns.map(compileGlob);
  return (path) => matchers.some((matches) => matches(path));
}

const isDefaultExempt = anyGlob(DEFAULT_EXEMPT);

/** Whether a path is left out of every signal by default (fixtures, test data, test files). */
export function isDefaultExemptPath(path: string): boolean {
  return isDefaultExempt(path);
}

/** The instruction kind of a path, or null: the inventory's classification, limited to the instruction kinds. */
export function instructionKindOf(path: string): AgentSetupKind | null {
  const kind = classifySetupPath(path);
  return kind !== null && INSTRUCTION_KIND_SET.has(kind) ? kind : null;
}

/**
 * The vendored directory and instruction kind of a path that is an instruction file inside vendored code, or null.
 * The part after the last vendored directory segment is classified from each of its segment starts, so
 * `node_modules/pkg/CLAUDE.md` and `vendor/x/.cursor/rules/a.mdc` count as `claude-md` and `cursor-rules`.
 */
export function vendoredInstruction(path: string): { dir: string; kind: AgentSetupKind } | null {
  const segments = path.split("/");
  let last = -1;
  for (let i = 0; i < segments.length - 1; i++) {
    if (VENDORED_DIRS.includes(segments[i] as string)) last = i;
  }
  if (last === -1) return null;
  const rest = segments.slice(last + 1);
  for (let start = 0; start < rest.length; start++) {
    const kind = instructionKindOf(rest.slice(start).join("/"));
    if (kind !== null) return { dir: segments[last] as string, kind };
  }
  return null;
}

/** The lower-case extension of the basename (without the dot), or "" for none or a dot-file. */
function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(["md", "mdx", "markdown", "mdc", "mdown", "mkd"]);
const PROSE_EXTENSIONS: ReadonlySet<string> = new Set(["txt", "rst", "adoc", "asciidoc", "org", "text"]);

/** Whether PI02 reads the file as Markdown: a Markdown extension, or an instruction file of any extension. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path)) || instructionKindOf(path) !== null;
}

/** Whether a line-start phrase (PH22) counts in the file: Markdown, plain text and other prose, or no extension. */
export function isProsePath(path: string): boolean {
  const extension = extensionOf(path);
  return extension === "" || PROSE_EXTENSIONS.has(extension) || isMarkdownPath(path);
}
