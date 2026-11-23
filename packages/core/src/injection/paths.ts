import { compileGlob } from "../glob.js";
import { INSTRUCTION_KINDS } from "../setup/instructions.js";
import { type AgentSetupKind, classifySetupPath } from "../setup/scan.js";

/**
 * Where each prompt-injection signal applies, by path only. Every check is a string or glob operation on the
 * repo-relative path: nothing is read.
 */

/** The directory exemptions: test fixtures and test data. They apply to every path, instruction files included. */
export const DEFAULT_EXEMPT_DIRS: readonly string[] = ["fixtures/**", "**/__fixtures__/**", "**/testdata/**"];

/**
 * The name exemptions: test files. They never apply to an agent instruction file (`instructionKindOf` not null), so
 * `.cursor/rules/a.test.mdc` and `.claude/commands/x.spec.md`, which an agent loads, are scanned.
 */
export const DEFAULT_EXEMPT_NAMES: readonly string[] = ["**/*.test.*", "**/*.spec.*"];

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

const isExemptDir = anyGlob(DEFAULT_EXEMPT_DIRS);
const isExemptName = anyGlob(DEFAULT_EXEMPT_NAMES);

/**
 * Whether a path is left out of every signal by default: under a fixture or test data directory, or named like a test
 * file and not an agent instruction file. The diff reader (`keepInjectionText`) and the scan loop both use it.
 */
export function isDefaultExemptPath(path: string): boolean {
  return isExemptDir(path) || (isExemptName(path) && instructionKindOf(path) === null);
}

/** The instruction kind of a path, or null: the inventory's classification, limited to the instruction kinds. */
export function instructionKindOf(path: string): AgentSetupKind | null {
  const kind = classifySetupPath(path);
  return kind !== null && INSTRUCTION_KIND_SET.has(kind) ? kind : null;
}

/** The most trailing segments below the last vendored directory that PI05 classifies, so the walk stays linear. */
export const MAX_VENDORED_TAIL_SEGMENTS = 8;

/**
 * The vendored directory and instruction kind of a path that is an instruction file inside vendored code, or null.
 * The last `MAX_VENDORED_TAIL_SEGMENTS` segments after the last vendored directory segment are classified from each of
 * their segment starts, so `node_modules/pkg/CLAUDE.md` and `vendor/x/.cursor/rules/a.mdc` count as `claude-md` and
 * `cursor-rules`.
 */
export function vendoredInstruction(path: string): { dir: string; kind: AgentSetupKind } | null {
  const segments = path.split("/");
  let last = -1;
  for (let i = 0; i < segments.length - 1; i++) {
    if (VENDORED_DIRS.includes(segments[i] as string)) last = i;
  }
  if (last === -1) return null;
  const rest = segments.slice(Math.max(last + 1, segments.length - MAX_VENDORED_TAIL_SEGMENTS));
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

/** The Markdown extensions whose files count against the scan's priority budget of added text. */
const PRIORITY_MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(["md", "mdx", "markdown", "mdc"]);

/**
 * Whether the scan keeps the file's added text against the priority budget (`MAX_PRIORITY_ADDED_TEXT_CHARS`) rather
 * than the budget for every other file: an agent instruction file (`instructionKindOf` not null) or a Markdown file
 * (`.md`, `.mdx`, `.markdown` or `.mdc`, in any case), by path only. A cut in such a file is an error.
 */
export function isPriorityInjectionPath(path: string): boolean {
  return PRIORITY_MARKDOWN_EXTENSIONS.has(extensionOf(path)) || instructionKindOf(path) !== null;
}

/** Whether PI02 reads the file as Markdown: a Markdown extension, or an instruction file of any extension. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path)) || instructionKindOf(path) !== null;
}

/** Whether a line-start phrase (PH22) counts in the file: Markdown, plain text and other prose, or no extension. */
export function isProsePath(path: string): boolean {
  const extension = extensionOf(path);
  return extension === "" || PROSE_EXTENSIONS.has(extension) || isMarkdownPath(path);
}
