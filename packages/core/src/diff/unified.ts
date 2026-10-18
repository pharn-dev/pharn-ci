export type DiffFileStatus = "added" | "modified" | "renamed" | "deleted";

export interface DiffFile {
  /** Repo-relative path in the new tree (the old path for deleted files). */
  path: string;
  /** Path in the old tree; differs from `path` only for renames. */
  oldPath: string;
  status: DiffFileStatus;
  /** 1-based line numbers added in the new file, ascending. */
  addedLines: number[];
  /**
   * Set (to `true`) only when the diff shows the file as binary (`Binary files ... differ` or
   * `GIT binary patch`), so it carries no added lines. Absent on every other entry.
   */
  binary?: true;
}

interface Entry {
  oldPath: string | null;
  newPath: string | null;
  status: DiffFileStatus;
  addedLines: number[];
  sawHunk: boolean;
  binary: boolean;
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff` unified output (any `--unified=N`, intended for N=0) into the
 * set of lines added per file. Removed lines are ignored; only added lines in
 * the new file count. Handles new, deleted, renamed and binary files, multiple
 * hunks, and C-quoted paths.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  return parseUnifiedDiffLines(text.split(/\r?\n/));
}

/** Parse the lines of a unified diff (already cut at line ends); same result as `parseUnifiedDiff` of the joined text. */
export function parseUnifiedDiffLines(lines: Iterable<string>): DiffFile[] {
  const reader = createUnifiedDiffReader();
  for (const line of lines) reader.push(line);
  return reader.finish();
}

/** Like `parseUnifiedDiffLines`, for lines that arrive from a stream. A rejection of the stream rejects the promise. */
export async function parseUnifiedDiffLinesAsync(lines: AsyncIterable<string>): Promise<DiffFile[]> {
  const reader = createUnifiedDiffReader();
  for await (const line of lines) reader.push(line);
  return reader.finish();
}

/**
 * A unified diff read one line at a time: `push` each line (without its line end), then `finish` for the files.
 * Memory holds the parsed paths and added line numbers, never the text.
 */
export function createUnifiedDiffReader(): { push(line: string): void; finish(): DiffFile[] } {
  const entries: Entry[] = [];
  let current: Entry | undefined;
  let oldRemaining = 0;
  let newRemaining = 0;
  let cursor = 0;

  const start = (): Entry => {
    current = { oldPath: null, newPath: null, status: "modified", addedLines: [], sawHunk: false, binary: false };
    entries.push(current);
    return current;
  };

  const push = (line: string): void => {
    if (current && (oldRemaining > 0 || newRemaining > 0)) {
      const marker = line[0];
      if (marker === "+") {
        current.addedLines.push(cursor++);
        newRemaining--;
        return;
      }
      if (marker === "-") {
        oldRemaining--;
        return;
      }
      if (marker === " ") {
        cursor++;
        oldRemaining--;
        newRemaining--;
        return;
      }
      if (marker === "\\") return; // "\ No newline at end of file"
      // Anything else means the hunk was shorter than announced; fall through.
      oldRemaining = 0;
      newRemaining = 0;
    }
    if (line.startsWith("\\")) return;

    if (line.startsWith("diff --git ")) {
      const entry = start();
      const header = parseGitHeader(line.slice("diff --git ".length));
      if (header) {
        entry.oldPath = header.oldPath;
        entry.newPath = header.newPath;
      }
    } else if (line.startsWith("new file mode")) {
      if (current) current.status = "added";
    } else if (line.startsWith("deleted file mode")) {
      if (current) current.status = "deleted";
    } else if (line.startsWith("rename from ")) {
      if (current) {
        current.status = "renamed";
        current.oldPath = unquote(line.slice("rename from ".length));
      }
    } else if (line.startsWith("rename to ")) {
      if (current) {
        current.status = "renamed";
        current.newPath = unquote(line.slice("rename to ".length));
      }
    } else if (line.startsWith("--- ")) {
      const entry = !current || current.sawHunk ? start() : current;
      const path = parseMarkerPath(line.slice(4));
      if (path === null) entry.status = "added";
      else entry.oldPath = path;
    } else if (line.startsWith("+++ ")) {
      const entry = current ?? start();
      const path = parseMarkerPath(line.slice(4));
      if (path === null) entry.status = "deleted";
      else entry.newPath = path;
    } else if ((line.startsWith("Binary files ") && line.endsWith(" differ")) || line === "GIT binary patch") {
      if (current) current.binary = true;
    } else if (line.startsWith("@@ ")) {
      const match = HUNK_HEADER.exec(line);
      if (!match || !current) return;
      current.sawHunk = true;
      oldRemaining = match[1] === undefined ? 1 : Number(match[1]);
      cursor = Number(match[2]);
      newRemaining = match[3] === undefined ? 1 : Number(match[3]);
    }
  };

  const finish = (): DiffFile[] => {
    const files: DiffFile[] = [];
    for (const e of entries) {
      const path = e.status === "deleted" ? (e.oldPath ?? e.newPath) : (e.newPath ?? e.oldPath);
      if (path === null) continue;
      files.push({
        path,
        oldPath: e.oldPath ?? path,
        status: e.status === "deleted" ? "deleted" : e.status,
        addedLines: e.status === "deleted" ? [] : [...new Set(e.addedLines)].sort((a, b) => a - b),
        ...(e.binary ? { binary: true as const } : {}),
      });
    }
    return files;
  };

  return { push, finish };
}

/** `a/foo.ts`, `"b/sp\303\251cial.ts"`, `/dev/null` (-> null). Strips one prefix segment. */
function parseMarkerPath(raw: string): string | null {
  // git appends a tab after paths that contain spaces in some modes.
  const value = unquote(stripTabSuffix(raw));
  if (value === "/dev/null") return null;
  return stripPrefix(value);
}

/**
 * `raw` without its tab suffix, exactly as `raw.replace(/\t.*$/, "")` but in linear time: the cut is at the first tab
 * after the last line terminator (`.` matches none of them), so a run of tabs cannot make it backtrack.
 */
export function stripTabSuffix(raw: string): string {
  let lastBreak = -1;
  for (const terminator of ["\n", "\r", " ", " "]) lastBreak = Math.max(lastBreak, raw.lastIndexOf(terminator));
  const tab = raw.indexOf("\t", lastBreak + 1);
  return tab === -1 ? raw : raw.slice(0, tab);
}

function stripPrefix(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Best-effort parse of the `diff --git a/X b/Y` header; later lines override it. */
function parseGitHeader(rest: string): { oldPath: string; newPath: string } | null {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    if (end === -1) return null;
    const oldPath = stripPrefix(unquote(rest.slice(0, end + 1)));
    const newPath = stripPrefix(unquote(rest.slice(end + 2)));
    return { oldPath, newPath };
  }
  // Unquoted: for non-renames both halves are equal, so split in the middle.
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === " ") {
    const a = stripPrefix(rest.slice(0, half));
    const b = stripPrefix(rest.slice(half + 1));
    if (a === b) return { oldPath: a, newPath: b };
  }
  const split = rest.lastIndexOf(" b/");
  if (split === -1) return null;
  return { oldPath: stripPrefix(rest.slice(0, split)), newPath: stripPrefix(rest.slice(split + 1)) };
}

function closingQuote(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === '"') return i;
  }
  return -1;
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** Undo git's C-style path quoting (core.quotePath), decoding octal UTF-8 bytes. */
export function unquote(value: string): string {
  if (!(value.length >= 2 && value.startsWith('"') && value.endsWith('"'))) return value;
  const body = value.slice(1, -1);
  // Build a percent-encoded string, then decode it as UTF-8 in one go.
  let encoded = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      encoded += encodeURIComponent(ch);
      continue;
    }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1))?.[0];
    const next = body[i + 1] ?? "";
    let byte = 92;
    if (octal) {
      byte = Number.parseInt(octal, 8);
      i += 3;
    } else if (next in ESCAPES) {
      byte = ESCAPES[next] as number;
      i += 1;
    }
    encoded += `%${byte.toString(16).padStart(2, "0")}`;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return body;
  }
}
