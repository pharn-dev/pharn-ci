import { byCodeUnit } from "../text.js";
import {
  blockReader,
  codeSpans,
  commandsOfLine,
  firstNonSpace,
  hasCueWord,
  isLetter,
  normalizeWord,
  shellLine,
} from "./instructionLines.js";
import type { AgentSetupFile, AgentSetupInventory, AgentSetupKind } from "./scan.js";

/**
 * The agent setup kinds whose files are Markdown-like instructions that P07 compares: what an agent is told to run. The
 * machine-readable config kinds are read by check A7 instead, and skills, commands, agents and prompts are not read.
 */
export const INSTRUCTION_KINDS: readonly AgentSetupKind[] = [
  "claude-md",
  "claude-local-md",
  "agents-md",
  "gemini-md",
  "goosehints",
  "cursor-rules",
  "claude-rule",
  "copilot-instructions",
  "copilot-instructions-scoped",
  "windsurf-rules",
  "cline-rules",
  "conventions-md",
  "continue-rules",
  "roo-rules",
  "amazonq-rules",
  "junie-guidelines",
  "zed-rules",
  "augment-rules",
  "kiro-steering",
];

const INSTRUCTION_KIND_SET: ReadonlySet<AgentSetupKind> = new Set(INSTRUCTION_KINDS);
/** The kinds that apply to the directory they sit in. */
const DIRECTORY_KINDS: ReadonlySet<AgentSetupKind> = new Set([
  "claude-md",
  "claude-local-md",
  "agents-md",
  "gemini-md",
  "goosehints",
]);
const CONTINUE_CONFIG_EXTENSIONS: readonly string[] = [".json", ".yaml", ".yml"];

/**
 * True when the file is an instruction file. A `continue-rules` file that is JSON or YAML is config (check A7 reads it),
 * so only its other files count.
 */
export function isInstructionFile(file: AgentSetupFile): boolean {
  if (!INSTRUCTION_KIND_SET.has(file.kind)) return false;
  if (file.kind === "continue-rules") {
    const lower = file.path.toLowerCase();
    return !CONTINUE_CONFIG_EXTENSIONS.some((extension) => lower.endsWith(extension));
  }
  return true;
}

/** The text before the first `anchor` that starts the path or follows a `/`; `""` when there is none. */
function beforeAnchor(path: string, anchor: string): string {
  let from = 0;
  for (;;) {
    const i = path.indexOf(anchor, from);
    if (i === -1) return "";
    if (i === 0 || path[i - 1] === "/") return path.slice(0, i);
    from = i + 1;
  }
}

/**
 * The directory an instruction file applies to, as a prefix: `""` at the repo root, `packages/web/` for a file of that
 * package. A hierarchical file (CLAUDE.md, AGENTS.md, ...) applies to its own directory, a nested `.cursor/rules/` or
 * `.claude/rules/` directory to the directory that holds it, and every other kind to the root.
 */
export function instructionScope(file: AgentSetupFile): string {
  if (DIRECTORY_KINDS.has(file.kind)) return file.path.slice(0, file.path.lastIndexOf("/") + 1);
  if (file.kind === "cursor-rules") return beforeAnchor(file.path, ".cursor/rules/");
  if (file.kind === "claude-rule") return beforeAnchor(file.path, ".claude/rules/");
  return "";
}

/**
 * The paths P07 reads: the instruction files of every scope that holds at least two of them (one file has nothing to
 * contradict), de-duplicated and sorted in code-unit order.
 */
export function agentInstructionPaths(inventory: AgentSetupInventory): string[] {
  const scopes = new Map<string, Set<string>>();
  for (const file of inventory.files) {
    if (!isInstructionFile(file)) continue;
    const scope = instructionScope(file);
    const paths = scopes.get(scope);
    if (paths === undefined) scopes.set(scope, new Set([file.path]));
    else paths.add(file.path);
  }
  const kept: string[] = [];
  for (const paths of scopes.values()) if (paths.size >= 2) kept.push(...paths);
  return [...new Set(kept)].sort(byCodeUnit);
}

/** The package managers and test runners an instruction file names; the tool strings come from these constants only. */
const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
const TEST_RUNNERS = ["vitest", "jest"] as const;
export type InstructionPackageManager = (typeof PACKAGE_MANAGERS)[number];
export type InstructionTestRunner = (typeof TEST_RUNNERS)[number];

/** What one instruction file declares: the tools of each class and the line of the first declaration of the class. */
export interface InstructionDeclarations {
  patternScoped: boolean;
  packageManagers: { tools: InstructionPackageManager[]; line: number | null };
  testRunners: { tools: InstructionTestRunner[]; line: number | null };
}

/** The longest frontmatter: a closing `---` after line 50 means the file has none. */
const MAX_FRONTMATTER_LINE = 50;
const SCOPE_KEYS = ["globs:", "applyTo:", "paths:", "fileMatchPattern:"] as const;
const ALL_FILES_VALUES: ReadonlySet<string> = new Set(["**", "**/*", "*"]);

/** The words that negate a mention: what follows or precedes them in a gap is not what the file asks for. */
const CUE_WORDS: ReadonlySet<string> = new Set([
  "not",
  "never",
  "don't",
  "dont",
  "avoid",
  "instead",
  "rather",
  "without",
  "deprecated",
  "forbidden",
  "nor",
  "no",
]);
const AFTER_VERBS: ReadonlySet<string> = new Set(["is", "are", "was"]);
const AFTER_NEGATIONS: ReadonlySet<string> = new Set(["not", "never", "deprecated", "forbidden", "unsupported"]);
const AFTER_CONTRACTIONS: ReadonlySet<string> = new Set(["isn't", "aren't"]);

const RUNNER_LAUNCHERS: ReadonlySet<string> = new Set(["npx", "bunx", "npm", "pnpm", "yarn", "bun"]);
const RUNNER_SKIPPED: ReadonlySet<string> = new Set(["exec", "dlx", "run", "x", "--"]);
const GLOBAL_FLAGS: ReadonlySet<string> = new Set(["-g", "--global", "--location=global"]);

/** The first `limit` words of `line[from, to)`, lower-cased: a word is a run of letters and apostrophes (U+2019 counts as one). */
function wordsIn(line: string, from: number, to: number, limit: number): string[] {
  const words: string[] = [];
  let start = -1;
  let i = from;
  while (i < to && words.length < limit) {
    const first = line.codePointAt(i) as number;
    const char = String.fromCodePoint(first);
    const width = char.length;
    const inWord = char === "'" || char === "’" || isLetter(char);
    if (inWord && start === -1) start = i;
    if (!inWord && start !== -1) {
      words.push(normalizeWord(line.slice(start, i)));
      start = -1;
    }
    i += width;
  }
  if (start !== -1 && words.length < limit) words.push(normalizeWord(line.slice(start, to)));
  return words;
}

/** The counters the line loop fills; `line` is the 1-based line of the first declaration of the class. */
interface Collected {
  packageManagers: Set<InstructionPackageManager>;
  packageManagerLine: number | null;
  testRunners: Set<InstructionTestRunner>;
  testRunnerLine: number | null;
}

/** Read one command line: the package manager and the test runner of each segment. */
function declareCommand(commandLine: string, lineNumber: number, found: Collected): void {
  for (const { words: all, at } of commandsOfLine(commandLine)) {
    const first = all[at];
    if (first === undefined) continue;
    const manager = PACKAGE_MANAGERS.find((tool) => tool === first);
    if (
      manager !== undefined &&
      !all.some((word) => GLOBAL_FLAGS.has(word)) &&
      !(first === "yarn" && all[at + 1] === "global")
    ) {
      found.packageManagers.add(manager);
      if (found.packageManagerLine === null) found.packageManagerLine = lineNumber;
    }
    let runner = TEST_RUNNERS.find((tool) => tool === first);
    if (runner === undefined && RUNNER_LAUNCHERS.has(first)) {
      for (let i = at + 1; i < all.length; i++) {
        const word = all[i] as string;
        if (word.startsWith("-") || RUNNER_SKIPPED.has(word)) continue;
        runner = TEST_RUNNERS.find((tool) => tool === word);
        break;
      }
    }
    if (runner !== undefined) {
      found.testRunners.add(runner);
      if (found.testRunnerLine === null) found.testRunnerLine = lineNumber;
    }
  }
}

/** Whether the gap after a span, read for at most its first two words, negates the span. */
function negatedAfter(line: string, from: number, to: number): boolean {
  const [first, second] = wordsIn(line, from, to, 2);
  if (first === undefined) return false;
  if (AFTER_CONTRACTIONS.has(first)) return true;
  return AFTER_VERBS.has(first) && second !== undefined && AFTER_NEGATIONS.has(second);
}

/** Read the inline code spans of one prose line; a negated span declares nothing. */
function declareSpans(line: string, lineNumber: number, found: Collected): void {
  const spans = codeSpans(line);
  let gapStart = 0;
  spans.forEach((span, index) => {
    const next = spans[index + 1];
    const before = hasCueWord(line, gapStart, span.open, CUE_WORDS);
    const negated = before || negatedAfter(line, span.close, next === undefined ? line.length : next.open);
    gapStart = span.close;
    if (!negated) declareCommand(line.slice(span.from, span.to).trim(), lineNumber, found);
  });
}

/** True when the frontmatter lines `lines[1, close)` limit the file to path patterns. */
function frontmatterScoped(lines: readonly string[], close: number): boolean {
  for (let i = 1; i < close; i++) {
    const line = lines[i] as string;
    const key = SCOPE_KEYS.find((candidate) => line.startsWith(candidate));
    if (key === undefined) continue;
    let value = line.slice(key.length).trim();
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1);
    if (value !== "") {
      if (!ALL_FILES_VALUES.has(value)) return true;
      continue;
    }
    const nextLine = i + 1 < close ? (lines[i + 1] as string) : "";
    if (nextLine.slice(firstNonSpace(nextLine)).startsWith("- ")) return true;
  }
  return false;
}

/**
 * What an instruction file declares: whether it is limited to path patterns, and the package managers and test runners
 * it names in inline code spans and shell blocks, with the line of the first declaration of each class. Prose is never
 * read. One pass over the lines; the scans over a line use `indexOf`, character loops and bounded checks, never a
 * regular expression over the file's text. Pure; never throws.
 */
export function instructionDeclarations(text: string): InstructionDeclarations {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const found: Collected = {
    packageManagers: new Set(),
    packageManagerLine: null,
    testRunners: new Set(),
    testRunnerLine: null,
  };

  // Frontmatter: line 1 is `---` and a later line, at line 50 or earlier, is `---`. It declares nothing.
  let start = 0;
  let patternScoped = false;
  if (lines[0] === "---") {
    for (let i = 1; i < Math.min(lines.length, MAX_FRONTMATTER_LINE); i++) {
      if (lines[i] !== "---") continue;
      patternScoped = frontmatterScoped(lines, i);
      start = i + 1;
      break;
    }
  }

  const read = blockReader();
  let ignored = false;
  let previousBlank = true;
  let previousIndented = false;
  for (let index = start; index < lines.length; index++) {
    const raw = lines[index] as string;
    const lineNumber = index + 1;

    const block = read(raw);
    if (block.kind === "fenced") {
      if (block.shell && !ignored) {
        const command = shellLine(raw, block.session);
        if (command !== null) declareCommand(command, lineNumber, found);
      }
      continue;
    }
    if (block.kind === "skipped") {
      previousBlank = false;
      previousIndented = false;
      continue;
    }

    const line = block.line;
    const at = firstNonSpace(line);
    const char = line[at];
    if (char === "#") {
      ignored = hasCueWord(line, at, line.length, CUE_WORDS);
      previousBlank = false;
      previousIndented = false;
      if (ignored) continue;
    }

    const indented = line.startsWith("    ") || line.startsWith("\t");
    const asCode: boolean = indented && (previousBlank || previousIndented);
    previousBlank = at >= line.length;
    previousIndented = asCode;
    if (asCode || ignored) continue;
    declareSpans(line, lineNumber, found);
  }

  const order = <T extends string>(vocabulary: readonly T[], seen: ReadonlySet<T>) =>
    vocabulary.filter((tool) => seen.has(tool));
  return {
    patternScoped,
    packageManagers: {
      tools: order(PACKAGE_MANAGERS, found.packageManagers),
      line: found.packageManagerLine,
    },
    testRunners: { tools: order(TEST_RUNNERS, found.testRunners), line: found.testRunnerLine },
  };
}
