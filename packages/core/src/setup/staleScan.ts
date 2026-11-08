/**
 * Stale instructions (H3, signals SI01 to SI03): the tokens an agent instruction file names that can be checked
 * against the repository. Only inline code spans, shell-fenced blocks, Markdown link targets and Claude-style `@path`
 * imports are read; prose is never read. One pass over the lines; each line is scanned with `indexOf` and character
 * loops, never a regular expression over the file's text. Pure; never throws.
 */
import { JS_TS_EXTENSIONS } from "../jsTsExtensions.js";

/** The most code units of one instruction file that are scanned; the rest is not read. */
export const MAX_SCAN_CHARS = 256 * 1024;
/** The most tokens one file yields; the rest are not checked. */
export const MAX_TOKENS_PER_FILE = 2000;
/** The longest path token that is checked. */
export const MAX_PATH_TOKEN = 200;
/** The longest script or target name that is checked. */
export const MAX_COMMAND_NAME = 100;
/** The most targets one `make` command names that are checked. */
const MAX_MAKE_TARGETS = 10;
/** The longest frontmatter: a closing `---` after line 50 means the file has none. */
const MAX_FRONTMATTER_LINE = 50;

export type StaleManager = "npm" | "pnpm" | "yarn" | "bun" | "make";

/** A command an instruction file names: a package-manager script or a make target, at a 1-based line. */
export interface InstructionCommand {
  manager: StaleManager;
  name: string;
  line: number;
}

/**
 * A path an instruction file names (`path`: an inline code span) or tells the agent to read (`file`: a Markdown link
 * target or an `@path` import), at a 1-based line. `relative` is true when the token starts with `./` or `../`, so it
 * resolves against the file's directory only; `bare` when it has a known extension and no `/`, so any tracked file of
 * that name counts.
 */
export interface InstructionReference {
  kind: "path" | "file";
  token: string;
  line: number;
  relative: boolean;
  bare: boolean;
  /** True for a token without a known extension: checked only when its first segment names a tracked directory. */
  extensionless: boolean;
}

export interface InstructionTokens {
  commands: InstructionCommand[];
  references: InstructionReference[];
}

/** The fence info words whose blocks are shell, so their lines are read for commands; any other block is an example. */
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
]);
const SESSION_INFO: ReadonlySet<string> = new Set(["console", "terminal", "shell-session", "shellsession"]);

/** Words that negate or retire what a line names: a line or a section under a heading with one is not read. */
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
  "removed",
  "deleted",
  "legacy",
  "formerly",
  "renamed",
  "replaced",
  "obsolete",
  "example",
  "examples",
  "e.g",
]);

const WRAPPER_WORDS: ReadonlySet<string> = new Set(["sudo", "time", "env"]);
/** The words after which the rest of a command line runs somewhere else, so it is not read. */
const DIRECTORY_WORDS: ReadonlySet<string> = new Set(["cd", "pushd"]);

/** pnpm's own commands (and their aliases): `pnpm <one of these>` is never a script. */
const PNPM_BUILTINS: ReadonlySet<string> = new Set([
  "add",
  "approve-builds",
  "audit",
  "bin",
  "c",
  "cache",
  "cat-file",
  "cat-index",
  "catalog",
  "config",
  "create",
  "dedupe",
  "deploy",
  "dlx",
  "doctor",
  "env",
  "exec",
  "fetch",
  "find-hash",
  "help",
  "i",
  "ignored-builds",
  "import",
  "init",
  "install",
  "install-test",
  "it",
  "la",
  "licenses",
  "link",
  "list",
  "ll",
  "ln",
  "ls",
  "outdated",
  "pack",
  "patch",
  "patch-commit",
  "patch-remove",
  "prune",
  "publish",
  "rb",
  "rebuild",
  "recursive",
  "remove",
  "restart",
  "rm",
  "root",
  "self-update",
  "server",
  "setup",
  "start",
  "stop",
  "store",
  "t",
  "test",
  "tst",
  "un",
  "uninstall",
  "unlink",
  "up",
  "update",
  "upgrade",
  "why",
  "x",
]);

/** yarn's own commands (classic and berry): `yarn <one of these>` is never a script. */
const YARN_BUILTINS: ReadonlySet<string> = new Set([
  "add",
  "audit",
  "autoclean",
  "bin",
  "cache",
  "check",
  "config",
  "constraints",
  "create",
  "dedupe",
  "dlx",
  "exec",
  "explain",
  "generate-lock-entry",
  "global",
  "help",
  "import",
  "info",
  "init",
  "install",
  "licenses",
  "link",
  "list",
  "login",
  "logout",
  "node",
  "npm",
  "outdated",
  "owner",
  "pack",
  "patch",
  "patch-commit",
  "plugin",
  "policies",
  "publish",
  "rebuild",
  "remove",
  "search",
  "set",
  "stage",
  "start",
  "tag",
  "team",
  "test",
  "unlink",
  "unplug",
  "up",
  "upgrade",
  "upgrade-interactive",
  "version",
  "versions",
  "why",
  "workspace",
  "workspaces",
]);

/** Flags that run a command in another package or directory: a segment with one is not checked against the root. */
function isWorkspaceFlag(word: string): boolean {
  const flags = [
    "-r",
    "--recursive",
    "-F",
    "--filter",
    "-C",
    "--dir",
    "-w",
    "--workspace",
    "--workspaces",
    "-ws",
    "--ws",
    "--prefix",
    "--cwd",
    "-W",
    "--workspace-root",
    "--include-workspace-root",
  ];
  for (const flag of flags) {
    if (word === flag || word.startsWith(`${flag}=`)) return true;
  }
  return false;
}

/** make flags whose value changes the makefile or the directory: a segment with one is not checked. */
const MAKE_ELSEWHERE_FLAGS: readonly string[] = [
  "-C",
  "-f",
  "--file",
  "--directory",
  "--makefile",
  "-I",
  "--include-dir",
];
/** make flags that take the next word as their value. */
const MAKE_VALUE_FLAGS: ReadonlySet<string> = new Set(["-j", "-l", "-o", "-W", "--jobs", "--load-average"]);

/**
 * The extensions that make a token without a `/` a file name. Lower case; a token whose extension is not here (a
 * domain, `JSON.parse`, a version) is not read as a path.
 */
export const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  ...JS_TS_EXTENSIONS,
  "md",
  "mdc",
  "mdx",
  "txt",
  "rst",
  "adoc",
  "json",
  "jsonc",
  "json5",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "csv",
  "py",
  "pyi",
  "ipynb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "rb",
  "php",
  "cs",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "sql",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
  "astro",
  "graphql",
  "gql",
  "proto",
  "lock",
  "gradle",
  "tf",
  "hcl",
]);

/** Product names spelled like a file name; never read as a path. */
const PRODUCT_NAMES: ReadonlySet<string> = new Set([
  "node.js",
  "next.js",
  "nuxt.js",
  "vue.js",
  "react.js",
  "express.js",
  "nest.js",
  "three.js",
  "d3.js",
  "chart.js",
  "ember.js",
  "backbone.js",
  "alpine.js",
  "solid.js",
  "deno.js",
  "bun.js",
]);

/** Directory names of build output, caches and installs: a token under one is usually untracked on purpose. */
export const GENERATED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "tmp",
  ".tmp",
]);

const isSpaceCode = (code: number) => code === 32 || (code >= 9 && code <= 13) || code === 160;
const isAsciiLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isDigit = (code: number) => code >= 48 && code <= 57;

/** A repo-path character: ASCII letters, digits, `.`, `_`, `-`, `+` and `/`. */
function isPathChar(code: number): boolean {
  return (
    isAsciiLetter(code) || isDigit(code) || code === 46 || code === 95 || code === 45 || code === 43 || code === 47
  );
}

/** True when every character is a repo-path character (and, with `colonAt`, `:` and `@` too). */
function allChars(text: string, extra: boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isPathChar(code)) continue;
    if (extra && (code === 58 || code === 64)) continue;
    return false;
  }
  return true;
}

/** A script name that can be checked and reported: repo-path characters plus `:` and `@`, at most 100 of them. */
export function isSafeScriptName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_COMMAND_NAME && allChars(name, true) && !name.startsWith("-");
}

/** A make target that can be checked and reported: repo-path characters, at most 100 of them. */
export function isSafeTargetName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_COMMAND_NAME && allChars(name, false) && !name.startsWith("-");
}

/** A path token that can be reported: repo-path characters, at most 200 of them. */
export function isSafePathToken(token: string): boolean {
  return token.length > 0 && token.length <= MAX_PATH_TOKEN && allChars(token, false);
}

/** The index of the first character at or after `from` that is not a space or tab, or `line.length`. */
function firstNonSpace(line: string, from = 0): number {
  let i = from;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  return i;
}

/** True when `text` holds a cue word: a run of ASCII letters, apostrophes (U+2019 too) and dots, lower-cased. */
function hasCueWord(text: string): boolean {
  let start = -1;
  const flush = (end: number): boolean => {
    let word = text.slice(start, end).split("’").join("'").toLowerCase();
    start = -1;
    while (word.endsWith(".") || word.endsWith("'")) word = word.slice(0, -1);
    return CUE_WORDS.has(word);
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const inWord = isAsciiLetter(code) || code === 39 || code === 0x2019 || (code === 46 && start !== -1);
    if (inWord && start === -1) start = i;
    if (!inWord && start !== -1 && flush(i)) return true;
  }
  return start !== -1 && flush(text.length);
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
  const first = word.charCodeAt(0);
  if (!(isAsciiLetter(first) || first === 95)) return false;
  let i = 1;
  while (i < word.length) {
    const code = word.charCodeAt(i);
    if (!(isAsciiLetter(code) || isDigit(code) || code === 95)) break;
    i++;
  }
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

/** The script a JS package-manager command runs, or null when it runs no checkable root script. */
function scriptOf(manager: "npm" | "pnpm" | "yarn" | "bun", words: readonly string[], at: number): string | null {
  let i = at + 1;
  let word = words[i];
  if (word === undefined || word.startsWith("-")) return null;
  let explicit = false;
  if (word === "run" || (manager === "npm" && word === "run-script")) {
    explicit = true;
    i++;
    word = words[i];
    if (word === undefined || word.startsWith("-")) return null;
  }
  if (!explicit) {
    if (manager === "npm" || manager === "bun") return null;
    if (manager === "pnpm" && PNPM_BUILTINS.has(word)) return null;
    if (manager === "yarn" && YARN_BUILTINS.has(word)) return null;
  }
  // A path is a file to run (`bun run x.ts`, `pnpm ./bin.js`), not a script.
  if (word.includes("/") || word.startsWith(".")) return null;
  if (manager === "bun" && word.includes(".")) return null;
  for (let j = i + 1; j < words.length; j++) if (isWorkspaceFlag(words[j] as string)) return null;
  return isSafeScriptName(word) ? word : null;
}

/** The targets a `make` command names, or none when it changes the makefile or directory. */
function makeTargetsOf(words: readonly string[], at: number): string[] {
  const targets: string[] = [];
  for (let i = at + 1; i < words.length && targets.length < MAX_MAKE_TARGETS; i++) {
    const word = words[i] as string;
    if (word.startsWith("-")) {
      // `-C dir`, `-Cdir`, `--directory=dir`, `-f file`: another makefile or directory, so nothing is checked.
      const elsewhere = MAKE_ELSEWHERE_FLAGS.some((flag) =>
        flag.startsWith("--") ? word === flag || word.startsWith(`${flag}=`) : word.startsWith(flag),
      );
      if (elsewhere) return [];
      if (MAKE_VALUE_FLAGS.has(word)) i++;
      continue;
    }
    if (word.includes("=")) continue;
    if (isSafeTargetName(word)) targets.push(word);
  }
  return targets;
}

/** Read one command line for commands; stops at a `cd`, after which the rest runs in another directory. */
function commandsIn(text: string, line: number, out: InstructionCommand[]): void {
  for (const segment of commandSegments(text)) {
    let body = segment.trim();
    if (body.startsWith("(")) body = body.slice(1);
    if (body.endsWith(")")) body = body.slice(0, -1);
    const words = splitWords(body);
    let at = 0;
    while (at < words.length) {
      const word = words[at] as string;
      if (!isAssignment(word) && !WRAPPER_WORDS.has(word)) break;
      at++;
    }
    const first = words[at];
    if (first === undefined) continue;
    if (DIRECTORY_WORDS.has(first)) return;
    if (first === "make") {
      for (const name of makeTargetsOf(words, at)) out.push({ manager: "make", name, line });
      continue;
    }
    if (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") {
      const name = scriptOf(first, words, at);
      if (name !== null) out.push({ manager: first, name, line });
    }
  }
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

/** The inline code spans of a line as `[open, from, to, close)`: a run pairs with the next run of the same length. */
function codeSpans(line: string): { open: number; from: number; to: number; close: number }[] {
  const runs = backtickRuns(line);
  if (runs.length < 2) return [];
  const partner: number[] = new Array(runs.length).fill(-1);
  const nextOfLength = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i--) {
    const length = (runs[i] as [number, number])[1];
    partner[i] = nextOfLength.get(length) ?? -1;
    nextOfLength.set(length, i);
  }
  const spans: { open: number; from: number; to: number; close: number }[] = [];
  for (let i = 0; i < runs.length; ) {
    const j = partner[i] as number;
    if (j === -1) {
      i++;
      continue;
    }
    const [openAt, length] = runs[i] as [number, number];
    const [closeAt] = runs[j] as [number, number];
    spans.push({ open: openAt, from: openAt + length, to: closeAt, close: closeAt + length });
    i = j + 1;
  }
  return spans;
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

/** True for a version string: an optional `v`, then digits and dots only, with at least one dot. */
function isVersion(token: string): boolean {
  let i = token.startsWith("v") ? 1 : 0;
  if (i >= token.length || !isDigit(token.charCodeAt(i))) return false;
  let dots = 0;
  for (; i < token.length; i++) {
    const code = token.charCodeAt(i);
    if (code === 46) dots++;
    else if (!isDigit(code)) return false;
  }
  return dots > 0;
}

/** The extension of a file name, lower-cased, or null for none or a dot-file without one. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * A token read as a repository path, or null when it is not one. `requireShape`: an inline code span counts only when
 * it holds a `/` or a known extension; a link target or an import is a path by position. Guards: only repo-path
 * characters (so no URL, scheme, glob, placeholder, variable, `~`, `@`, quote or space), not absolute, not a flag, not
 * a version, no `node_modules` or build-output directory, no `.env` file, no product name like `Node.js`, and with a
 * `/` not a domain (`example.com/x`).
 */
export function classifyPath(
  raw: string,
  kind: "path" | "file",
  requireShape: boolean,
  line: number,
): InstructionReference | null {
  let token = raw;
  if (token.length === 0 || token.length > MAX_PATH_TOKEN) return null;
  if (!allChars(token, false)) return null;
  if (token.startsWith("/") || token.startsWith("-") || token.includes("//")) return null;
  if (isVersion(token)) return null;
  const relative = token.startsWith("./") || token.startsWith("../");
  while (token.startsWith("./")) token = token.slice(2);
  if (token === "" || token === "." || token === "..") return null;
  const trimmed = token.endsWith("/") ? token.slice(0, -1) : token;
  if (trimmed === "") return null;
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "" || GENERATED_DIRS.has(segment)) return null;
  }
  const name = segments[segments.length - 1] as string;
  if (name.startsWith(".env")) return null;
  const extension = extensionOf(name);
  const known = extension !== null && KNOWN_EXTENSIONS.has(extension) && !token.endsWith("/");
  const slash = token.includes("/");
  if (requireShape && !slash && !known) return null;
  if (!slash && PRODUCT_NAMES.has(name.toLowerCase())) return null;
  const first = segments[0] as string;
  if (slash && !relative && first.indexOf(".") > 0) return null;
  return {
    kind,
    token: trimmed,
    line,
    relative,
    bare: !slash && !relative,
    extensionless: !known,
  };
}

/** Markdown link targets in `text`: `](target)` and a reference definition `[label]: target`. */
function linkTargets(text: string): string[] {
  const targets: string[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf("](", from);
    if (at === -1) break;
    const start = at + 2;
    let end: number;
    let target: string;
    if (text[start] === "<") {
      end = text.indexOf(">", start + 1);
      if (end === -1) break;
      target = text.slice(start + 1, end);
    } else {
      end = text.indexOf(")", start);
      if (end === -1) break;
      target = text.slice(start, end).trim();
      // A title after the target: `(path "title")`.
      let cut = 0;
      while (cut < target.length && !isSpaceCode(target.charCodeAt(cut))) cut++;
      target = target.slice(0, cut);
    }
    targets.push(target);
    from = end + 1;
  }
  const lead = firstNonSpace(text);
  if (lead <= 3 && text[lead] === "[") {
    const close = text.indexOf("]:", lead + 1);
    if (close !== -1) {
      const rest = text.slice(close + 2).trim();
      let cut = 0;
      while (cut < rest.length && !isSpaceCode(rest.charCodeAt(cut))) cut++;
      let target = rest.slice(0, cut);
      if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
      if (target !== "") targets.push(target);
    }
  }
  return targets;
}

/** A link target as a repository path: without its `#fragment` and `?query`; null for an anchor or a URL. */
function linkPath(target: string, line: number): InstructionReference | null {
  let path = target;
  const hash = path.indexOf("#");
  if (hash !== -1) path = path.slice(0, hash);
  const query = path.indexOf("?");
  if (query !== -1) path = path.slice(0, query);
  if (path === "" || path.includes(":")) return null;
  return classifyPath(path, "file", false, line);
}

/** `@path` imports in `text`: an `@` that starts a word, then a path with a known extension or a `./` start. */
function importPaths(text: string, line: number, out: InstructionReference[]): void {
  let from = 0;
  for (;;) {
    const at = text.indexOf("@", from);
    if (at === -1) return;
    from = at + 1;
    if (at > 0 && !isSpaceCode(text.charCodeAt(at - 1))) continue;
    let end = at + 1;
    while (end < text.length && !isSpaceCode(text.charCodeAt(end))) end++;
    let word = text.slice(at + 1, end);
    while (word.length > 0 && ".,;:!?)".includes(word[word.length - 1] as string)) word = word.slice(0, -1);
    from = end;
    const reference = classifyPath(word, "file", false, line);
    if (reference === null) continue;
    if (reference.extensionless && !reference.relative) continue;
    out.push(reference);
  }
}

/** The text of a shell-block line after its prompt, or null when the line names no command. */
function shellLine(line: string, session: boolean): string | null {
  const rest = line.slice(firstNonSpace(line));
  if (rest.startsWith("$ ") || rest.startsWith("% ") || rest.startsWith("> ")) return rest.slice(2);
  if (session) return null;
  if (rest.startsWith("#")) return null;
  return rest;
}

/**
 * The commands and paths an instruction file names. Read: inline code spans of prose lines (a span with a space is a
 * command line, one without is a path when it looks like one), the lines of fenced blocks marked as shell or not
 * marked (commands only), Markdown link targets and `@path` imports outside code spans. Not read: frontmatter, HTML
 * comments, indented code blocks, fenced blocks of any other language (examples), and lines (or sections under a
 * heading) with a word such as `not`, `never`, `deprecated`, `removed` or `example`. At most `MAX_SCAN_CHARS` of the
 * text and `MAX_TOKENS_PER_FILE` tokens. Pure; never throws.
 */
export function scanInstructionTokens(text: string): InstructionTokens {
  const source = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  const lines = (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source)
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const commands: InstructionCommand[] = [];
  const references: InstructionReference[] = [];
  const full = () => commands.length + references.length >= MAX_TOKENS_PER_FILE;

  let start = 0;
  if (lines[0] === "---") {
    for (let i = 1; i < Math.min(lines.length, MAX_FRONTMATTER_LINE); i++) {
      if (lines[i] === "---") {
        start = i + 1;
        break;
      }
    }
  }

  const comment = { open: false };
  let fence: { char: string; length: number; shell: boolean; session: boolean } | null = null;
  let ignored = false;
  let previousBlank = true;
  let previousIndented = false;
  for (let index = start; index < lines.length && !full(); index++) {
    const raw = lines[index] as string;
    const lineNumber = index + 1;

    if (fence !== null) {
      const at = firstNonSpace(raw);
      let run = 0;
      while (raw[at + run] === fence.char) run++;
      if (run >= fence.length && raw.slice(at + run).trim() === "") {
        fence = null;
        previousBlank = false;
        previousIndented = false;
      } else if (fence.shell && !ignored) {
        const command = shellLine(raw, fence.session);
        if (command !== null) commandsIn(command, lineNumber, commands);
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
    if ((char === "`" || char === "~") && at < 4) {
      let run = 0;
      while (line[at + run] === char) run++;
      if (run >= 3) {
        const info = line.slice(at + run).trim();
        let end = 0;
        while (end < info.length && !isSpaceCode(info.charCodeAt(end)) && info[end] !== "{") end++;
        const word = info.slice(0, end).toLowerCase();
        fence = { char, length: run, shell: SHELL_INFO.has(word), session: SESSION_INFO.has(word) };
        previousBlank = false;
        previousIndented = false;
        continue;
      }
    }

    if (char === "#") {
      ignored = hasCueWord(line);
      previousBlank = false;
      previousIndented = false;
      if (ignored) continue;
    }

    const indented = line.startsWith("    ") || line.startsWith("\t");
    const asCode: boolean = indented && (previousBlank || previousIndented);
    previousBlank = at >= line.length;
    previousIndented = asCode;
    if (asCode || ignored || previousBlank) continue;

    const spans = codeSpans(line);
    // The words outside the spans decide whether the line negates what it names.
    let outside = "";
    let pos = 0;
    for (const span of spans) {
      outside += `${line.slice(pos, span.open)} `;
      pos = span.close;
    }
    outside += line.slice(pos);
    if (hasCueWord(outside)) continue;

    for (const span of spans) {
      const content = line.slice(span.from, span.to).trim();
      if (content === "") continue;
      let space = false;
      for (let i = 0; i < content.length && !space; i++) space = isSpaceCode(content.charCodeAt(i));
      if (space) {
        commandsIn(content.startsWith("$ ") ? content.slice(2) : content, lineNumber, commands);
      } else {
        const reference = classifyPath(content, "path", true, lineNumber);
        if (reference !== null) references.push(reference);
      }
    }
    for (const target of linkTargets(outside)) {
      const reference = linkPath(target, lineNumber);
      if (reference !== null) references.push(reference);
    }
    importPaths(outside, lineNumber, references);
  }

  return {
    commands: commands.slice(0, MAX_TOKENS_PER_FILE),
    references: references.slice(0, Math.max(0, MAX_TOKENS_PER_FILE - commands.length)),
  };
}
