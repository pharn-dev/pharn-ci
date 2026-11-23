/**
 * The line helpers the two instruction-file scans share: P07's declarations (`instructions.ts`) and the stale
 * instruction tokens (`staleScan.ts`). Each line is scanned with `indexOf`, character loops and bounded checks, never a
 * regular expression over the file's text. Pure; never throws.
 */

/** The fence info words whose blocks are shell, so their lines are read for commands; any other block is an example. */
export const SHELL_INFO: ReadonlySet<string> = new Set([
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
/** The shell fence info words that show a session: only a line after a prompt is a command. */
export const SESSION_INFO: ReadonlySet<string> = new Set(["console", "terminal", "shell-session", "shellsession"]);
/** The words a command line may start with before the command itself. */
const WRAPPER_WORDS: ReadonlySet<string> = new Set(["sudo", "time", "env"]);
/** The longest text between `PS` and `>` in a PowerShell prompt. */
const MAX_PS_PROMPT = 64;

export const isSpaceCode = (code: number) => code === 32 || (code >= 9 && code <= 13) || code === 160;
export const isAsciiLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isAsciiWordStart = (code: number) => isAsciiLetter(code) || code === 95;
const isAsciiNameChar = (code: number) => isAsciiWordStart(code) || (code >= 48 && code <= 57);

/** A letter, tested one character at a time; ASCII is decided without the Unicode property. */
export function isLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code < 128) return isAsciiLetter(code);
  return /\p{L}/u.test(char);
}

/** The index of the first character at or after `from` that is not a space or tab, or `line.length`. */
export function firstNonSpace(line: string, from = 0): number {
  let i = from;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  return i;
}

/** A word lower-cased, with the typographic apostrophe (U+2019) made a plain one. */
export function normalizeWord(word: string): string {
  return word.split("’").join("'").toLowerCase();
}

/**
 * True when `line[from, to)` holds one of `cueWords`. A word is a run of letters of any script, apostrophes (U+2019
 * counts as one) and dots after its first character, lower-cased, with trailing dots and apostrophes dropped: `Not.` is
 * `not`, `e.g.` is `e.g`, `not.md` is not `not`, and `Noël` is one word. One pass over the gap.
 */
export function hasCueWord(line: string, from: number, to: number, cueWords: ReadonlySet<string>): boolean {
  let start = -1;
  let i = from;
  const flush = (end: number): boolean => {
    let word = normalizeWord(line.slice(start, end));
    start = -1;
    while (word.endsWith(".") || word.endsWith("'")) word = word.slice(0, -1);
    return cueWords.has(word);
  };
  while (i < to) {
    const char = String.fromCodePoint(line.codePointAt(i) as number);
    const inWord = char === "'" || char === "’" || isLetter(char) || (char === "." && start !== -1);
    if (inWord && start === -1) start = i;
    if (!inWord && start !== -1 && flush(i)) return true;
    i += char.length;
  }
  return start !== -1 && flush(to);
}

/** Split on whitespace into words, by a character loop. */
export function splitWords(text: string): string[] {
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
export function isAssignment(word: string): boolean {
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

/**
 * The commands of a command line: for each segment between `&&`, `||`, `;` and `|`, its words (one `(` before and one
 * `)` after the segment dropped) and the index of the command word after any `NAME=value` assignments and the wrappers
 * `sudo`, `time` and `env` (equal to `words.length` when there is none).
 */
export function commandsOfLine(text: string): { words: string[]; at: number }[] {
  return commandSegments(text).map((segment) => {
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
    return { words, at };
  });
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

/** An inline code span: the backticks at `[open, from)` and `[to, close)`, the content at `[from, to)`. */
export interface CodeSpan {
  open: number;
  from: number;
  to: number;
  close: number;
}

/** The inline code spans of a line: a backtick run pairs with the next run of the same length; one without is literal. */
export function codeSpans(line: string): CodeSpan[] {
  const runs = backtickRuns(line);
  if (runs.length < 2) return [];
  // The next run of the same length, by one right-to-left pass.
  const partner: number[] = new Array(runs.length).fill(-1);
  const nextOfLength = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i--) {
    const length = (runs[i] as [number, number])[1];
    partner[i] = nextOfLength.get(length) ?? -1;
    nextOfLength.set(length, i);
  }
  const spans: CodeSpan[] = [];
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
export function withoutComments(line: string, state: { open: boolean }): string | null {
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
 * What one line of an instruction file is to the block reader: a line inside a fenced block (with whether the block is
 * shell, and a session), a line the scans skip (a fence line, or a line wholly inside an HTML comment), or text outside
 * any fence, with its HTML comments removed.
 */
export type BlockLine =
  | { kind: "fenced"; shell: boolean; session: boolean }
  | { kind: "skipped" }
  | { kind: "text"; line: string };

/** The language word of a fence's info string: the first word, cut at `{`, or the word in a leading `{…}`. */
export function fenceInfoWord(info: string): string {
  let end = 0;
  while (end < info.length && !isSpaceCode(info.charCodeAt(end)) && info[end] !== "{") end++;
  if (end > 0 || info[0] !== "{") return info.slice(0, end).toLowerCase();
  // `{bash}`, `{.sh .numberLines}`, `{r, echo=FALSE}`: the word after the brace and an optional class dot.
  const from = info[1] === "." ? 2 : 1;
  end = from;
  while (end < info.length && !isSpaceCode(info.charCodeAt(end)) && info[end] !== "}" && info[end] !== ",") end++;
  return info.slice(from, end).toLowerCase();
}

/** The length of the backtick or tilde run at `at`, or 0. */
function fenceRun(line: string, at: number): number {
  const char = line[at];
  if (char !== "`" && char !== "~") return 0;
  let run = 1;
  while (line[at + run] === char) run++;
  return run;
}

/**
 * The content column of a list item that starts at `at` (`-`, `+` or `*`, or 1 to 9 digits and `.` or `)`, then a
 * space, a tab or the end of the line), or -1 when the line starts no list item.
 */
function listItemContent(line: string, at: number): number {
  let end = at;
  const char = line[at];
  if (char === "-" || char === "+" || char === "*") {
    end = at + 1;
  } else {
    while (end < line.length && end - at < 10 && line.charCodeAt(end) >= 48 && line.charCodeAt(end) <= 57) end++;
    if (end === at || end - at > 9 || (line[end] !== "." && line[end] !== ")")) return -1;
    end++;
  }
  if (end === line.length) return end + 1;
  if (line[end] !== " " && line[end] !== "\t") return -1;
  const content = firstNonSpace(line, end);
  // Five or more spaces after the marker: the item's text is indented code, and the content starts after one space.
  return content === line.length || content - end > 4 ? end + 1 : content;
}

/**
 * The fenced-block reader both instruction scans share, as CommonMark reads a fence. A fence opens on a run of three
 * or more backticks or tildes indented at most three spaces past the content column of the list item that holds the
 * line (a line inside an item's indentation belongs to the item), or as the text of a list item on its marker's line
 * (`- ```bash`); deeper, the line is indented code. It closes on a run of the same character at least as long,
 * followed only by spaces and tabs; a run with text after it is a line of the block. The block's language is the first
 * word of the info string (`fenceInfoWord`). List items are the only containers followed (not block quotes). Lines
 * inside a fence are raw; other lines lose their HTML comments first. Call the returned function once per line, in
 * order. Pure; never throws.
 */
export function blockReader(): (raw: string) => BlockLine {
  const comment = { open: false };
  let fence: { char: string; length: number; shell: boolean; session: boolean } | null = null;
  // The content columns of the open list items, outermost first.
  const items: number[] = [];
  // The previous line was paragraph text, so a less indented line may continue it (a lazy continuation line).
  let paragraph = false;
  return (raw) => {
    if (fence !== null) {
      const at = firstNonSpace(raw);
      let run = 0;
      while (raw[at + run] === fence.char) run++;
      if (run >= fence.length && firstNonSpace(raw, at + run) === raw.length) {
        fence = null;
        return { kind: "skipped" };
      }
      return { kind: "fenced", shell: fence.shell, session: fence.session };
    }
    const line = withoutComments(raw, comment);
    if (line === null) {
      paragraph = false;
      return { kind: "skipped" };
    }
    const at = firstNonSpace(line);
    if (at >= line.length) {
      paragraph = false;
      return { kind: "text", line };
    }
    const char = line[at];
    const content = listItemContent(line, at);
    // A less indented line leaves the items it is not inside, unless it continues a paragraph.
    const lazy = paragraph && fenceRun(line, at) < 3 && content === -1 && char !== "#";
    if (!lazy) while (items.length > 0 && (items[items.length - 1] as number) > at) items.pop();
    const indent = at - (items.length > 0 ? (items[items.length - 1] as number) : 0);
    if (indent >= 4) {
      paragraph = paragraph && char !== "#";
      return { kind: "text", line };
    }
    if (content !== -1) items.push(content);
    // The fence starts the line, or the text of the list item the line starts (`- ```bash`).
    const from = content !== -1 && content < line.length ? content : at;
    const run = fenceRun(line, from);
    if (run >= 3) {
      const word = fenceInfoWord(line.slice(from + run).trim());
      const fenceChar = line[from] as string;
      fence = { char: fenceChar, length: run, shell: SHELL_INFO.has(word), session: SESSION_INFO.has(word) };
      paragraph = false;
      return { kind: "skipped" };
    }
    paragraph = char !== "#";
    return { kind: "text", line };
  };
}

/**
 * The text of a shell-block line after its prompt, or null when the line names no command. In a session block only a
 * line after a `$ `, `% ` or `> ` prompt, or a PowerShell `PS …> ` prompt, is a command; in any other shell block every
 * line is, after such a prompt if it has one, except a `#` comment.
 */
export function shellLine(line: string, session: boolean): string | null {
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
