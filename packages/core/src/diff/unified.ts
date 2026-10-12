export type DiffFileStatus = "added" | "modified" | "renamed" | "deleted";

export interface DiffFile {
  /** Repo-relative path in the new tree (the old path for deleted files). */
  path: string;
  /** Path in the old tree; differs from `path` only for renames. */
  oldPath: string;
  status: DiffFileStatus;
  /** 1-based line numbers added in the new file, ascending. */
  addedLines: number[];
}

interface Entry {
  oldPath: string | null;
  newPath: string | null;
  status: DiffFileStatus;
  addedLines: number[];
  sawHunk: boolean;
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff` unified output (any `--unified=N`, intended for N=0) into the
 * set of lines added per file. Removed lines are ignored; only added lines in
 * the new file count. Handles new, deleted, renamed and binary files, multiple
 * hunks, and C-quoted paths.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const entries: Entry[] = [];
  let current: Entry | undefined;
  let oldRemaining = 0;
  let newRemaining = 0;
  let cursor = 0;

  const start = (): Entry => {
    current = { oldPath: null, newPath: null, status: "modified", addedLines: [], sawHunk: false };
    entries.push(current);
    return current;
  };

  for (const line of text.split(/\r?\n/)) {
    if (current && (oldRemaining > 0 || newRemaining > 0)) {
      const marker = line[0];
      if (marker === "+") {
        current.addedLines.push(cursor++);
        newRemaining--;
        continue;
      }
      if (marker === "-") {
        oldRemaining--;
        continue;
      }
      if (marker === " ") {
        cursor++;
        oldRemaining--;
        newRemaining--;
        continue;
      }
      if (marker === "\\") continue; // "\ No newline at end of file"
      // Anything else means the hunk was shorter than announced; fall through.
      oldRemaining = 0;
      newRemaining = 0;
    }
    if (line.startsWith("\\")) continue;

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
    } else if (line.startsWith("@@ ")) {
      const match = HUNK_HEADER.exec(line);
      if (!match || !current) continue;
      current.sawHunk = true;
      oldRemaining = match[1] === undefined ? 1 : Number(match[1]);
      cursor = Number(match[2]);
      newRemaining = match[3] === undefined ? 1 : Number(match[3]);
    }
  }

  const files: DiffFile[] = [];
  for (const e of entries) {
    const path = e.status === "deleted" ? (e.oldPath ?? e.newPath) : (e.newPath ?? e.oldPath);
    if (path === null) continue;
    files.push({
      path,
      oldPath: e.oldPath ?? path,
      status: e.status === "deleted" ? "deleted" : e.status,
      addedLines: e.status === "deleted" ? [] : [...new Set(e.addedLines)].sort((a, b) => a - b),
    });
  }
  return files;
}

/** `a/foo.ts`, `"b/sp\303\251cial.ts"`, `/dev/null` (-> null). Strips one prefix segment. */
function parseMarkerPath(raw: string): string | null {
  // git appends a tab after paths that contain spaces in some modes.
  const value = unquote(raw.replace(/\t.*$/, ""));
  if (value === "/dev/null") return null;
  return stripPrefix(value);
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
