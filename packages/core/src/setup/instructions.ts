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

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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

/** The fence info words whose blocks are shell, and the subset that shows a session with prompts. */
const SHELL_INFO: ReadonlySet<string> = new Set([
  "",
  "sh",
  "bash",
  "shell",
  "zsh",
  "fish",
  "console",
  "terminal",
  "shell-session",
  "shellsession",
  "powershell",
  "pwsh",
  "ps1",
  "cmd",
  "bat",
]);
const SESSION_INFO: ReadonlySet<string> = new Set(["console", "terminal", "shell-session", "shellsession"]);
const WRAPPER_WORDS: ReadonlySet<string> = new Set(["sudo", "time", "env"]);
const RUNNER_LAUNCHERS: ReadonlySet<string> = new Set(["npx", "bunx", "npm", "pnpm", "yarn", "bun"]);
const RUNNER_SKIPPED: ReadonlySet<string> = new Set(["exec", "dlx", "run", "x", "--"]);
const GLOBAL_FLAGS: ReadonlySet<string> = new Set(["-g", "--global", "--location=global"]);
/** The longest text between `PS` and `>` in a PowerShell prompt. */
const MAX_PS_PROMPT = 64;

const isSpaceCode = (code: number) => code === 32 || (code >= 9 && code <= 13) || code === 160;
const isAsciiLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isAsciiWordStart = (code: number) => isAsciiLetter(code) || code === 95;
const isAsciiNameChar = (code: number) => isAsciiWordStart(code) || (code >= 48 && code <= 57);
/** A letter, tested one character at a time; ASCII is decided without the Unicode property. */
function isLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code < 128) return isAsciiLetter(code);
  return /\p{L}/u.test(char);
}

/** The index of the first character at or after `from` that is not a space or tab, or `line.length`. */
function firstNonSpace(line: string, from = 0): number {
  let i = from;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  return i;
}

/** A word lower-cased, with the typographic apostrophe (U+2019) made a plain one. */
function normalizeWord(word: string): string {
  return word.split("’").join("'").toLowerCase();
}

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

/** True when `line[from, to)` holds a cue word. One pass over the gap. */
function hasCueWord(line: string, from: number, to: number): boolean {
  let start = -1;
  let i = from;
  const flush = (end: number) => {
    const word = normalizeWord(line.slice(start, end));
    start = -1;
    return CUE_WORDS.has(word);
  };
  while (i < to) {
    const char = String.fromCodePoint(line.codePointAt(i) as number);
    const inWord = char === "'" || char === "’" || isLetter(char);
    if (inWord && start === -1) start = i;
    if (!inWord && start !== -1 && flush(i)) return true;
    i += char.length;
  }
  return start !== -1 && flush(to);
}

/** Split on whitespace into words, by a character loop. */
function splitWords(text: string): string[] {
  const words: string[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const space = isSpaceCode(text.charCodeAt(i));
    if (!space && start === -1) start = i;
    if (space && start !== -1) {
      words.push(text.slice(start, i));
      start = -1;
    }
  }
  if (start !== -1) words.push(text.slice(start));
  return words;
}

/** True for `NAME=value`: a letter or `_`, then letters, digits or `_`, then `=`. */
function isAssignment(word: string): boolean {
  if (word.length === 0 || !isAsciiWordStart(word.charCodeAt(0))) return false;
  let i = 1;
  while (i < word.length && isAsciiNameChar(word.charCodeAt(i))) i++;
  return i < word.length && word[i] === "=";
}

/** Split a command line on `&&`, `||`, `;` and `|`, scanning the characters once. */
function commandSegments(text: string): string[] {
  const segments: string[] = [];
  let from = 0;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
      segments.push(text.slice(from, i));
      i += 2;
      from = i;
    } else if (char === ";" || char === "|") {
      segments.push(text.slice(from, i));
      i += 1;
      from = i;
    } else {
      i += 1;
    }
  }
  segments.push(text.slice(from));
  return segments;
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
  for (const segment of commandSegments(commandLine)) {
    let text = segment.trim();
    if (text.startsWith("(")) text = text.slice(1);
    if (text.endsWith(")")) text = text.slice(0, -1);
    const all = splitWords(text);
    let at = 0;
    while (at < all.length) {
      const word = all[at] as string;
      if (!isAssignment(word) && !WRAPPER_WORDS.has(word)) break;
      at++;
    }
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

/** The text of a counted shell-block line after its prompt, or null when the line declares nothing. */
function shellLine(line: string, session: boolean): string | null {
  const start = firstNonSpace(line);
  if (session) {
    const rest = line.slice(start);
    if (rest.startsWith("$ ") || rest.startsWith("% ") || rest.startsWith("> ")) return rest.slice(2);
    if (rest.startsWith("PS")) {
      const limit = Math.min(rest.length, 2 + MAX_PS_PROMPT + 1);
      for (let i = 2; i < limit; i++) {
        if (rest[i] !== ">") continue;
        return rest[i + 1] === " " ? rest.slice(i + 2) : null;
      }
    }
    return null;
  }
  let rest = line.slice(start);
  if (rest.startsWith("$ ") || rest.startsWith("% ") || rest.startsWith("> ")) rest = rest.slice(2);
  const body = firstNonSpace(rest);
  if (rest[body] === "#") return null;
  return rest;
}

/** `[start, length]` of each backtick run of a line. */
function backtickRuns(line: string): [number, number][] {
  const runs: [number, number][] = [];
  let i = line.indexOf("`");
  while (i !== -1) {
    let end = i + 1;
    while (end < line.length && line[end] === "`") end++;
    runs.push([i, end - i]);
    i = line.indexOf("`", end);
  }
  return runs;
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
  const runs = backtickRuns(line);
  if (runs.length < 2) return;
  // The next run of the same length, by one right-to-left pass.
  const partner: number[] = new Array(runs.length).fill(-1);
  const nextOfLength = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i--) {
    const length = (runs[i] as [number, number])[1];
    partner[i] = nextOfLength.get(length) ?? -1;
    nextOfLength.set(length, i);
  }
  const spans: { from: number; to: number; open: number; close: number }[] = [];
  for (let i = 0; i < runs.length; ) {
    const j = partner[i] as number;
    if (j === -1) {
      i++;
      continue;
    }
    const [openAt, length] = runs[i] as [number, number];
    const [closeAt] = runs[j] as [number, number];
    spans.push({ from: openAt + length, to: closeAt, open: openAt, close: closeAt + length });
    i = j + 1;
  }
  let gapStart = 0;
  spans.forEach((span, index) => {
    const next = spans[index + 1];
    const before = hasCueWord(line, gapStart, span.open);
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

/** The line without the HTML comments of a prose line, or null when the whole line is inside a comment. */
function withoutComments(line: string, state: { open: boolean }): string | null {
  let pos = 0;
  if (state.open) {
    const end = line.indexOf("-->");
    if (end === -1) return null;
    state.open = false;
    pos = end + 3;
  }
  let out = "";
  for (;;) {
    const open = line.indexOf("<!--", pos);
    if (open === -1) return out + line.slice(pos);
    out += line.slice(pos, open);
    const close = line.indexOf("-->", open + 4);
    if (close === -1) {
      state.open = true;
      return out;
    }
    out += " ";
    pos = close + 3;
  }
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

  const comment = { open: false };
  let fence: { char: string; length: number; counted: boolean; session: boolean } | null = null;
  let ignored = false;
  let previousBlank = true;
  let previousIndented = false;
  for (let index = start; index < lines.length; index++) {
    const raw = lines[index] as string;
    const lineNumber = index + 1;

    if (fence !== null) {
      const at = firstNonSpace(raw);
      let run = 0;
      while (raw[at + run] === fence.char) run++;
      if (run >= fence.length) {
        fence = null;
        previousBlank = false;
        previousIndented = false;
      } else if (fence.counted && !ignored) {
        const command = shellLine(raw, fence.session);
        if (command !== null) declareCommand(command, lineNumber, found);
      }
      continue;
    }

    const line = withoutComments(raw, comment);
    if (line === null) {
      previousBlank = false;
      previousIndented = false;
      continue;
    }

    const at = firstNonSpace(line);
    const char = line[at];
    if (char === "`" || char === "~") {
      let run = 0;
      while (line[at + run] === char) run++;
      if (run >= 3) {
        const info = line.slice(at + run).trim();
        let end = 0;
        while (end < info.length && !isSpaceCode(info.charCodeAt(end))) end++;
        const word = info.slice(0, end).toLowerCase();
        fence = { char, length: run, counted: SHELL_INFO.has(word), session: SESSION_INFO.has(word) };
        previousBlank = false;
        previousIndented = false;
        continue;
      }
    }

    if (char === "#") {
      ignored = hasCueWord(line, at, line.length);
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
