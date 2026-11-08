/**
 * The CODEOWNERS comparison of rule P13. Conservative: the only change that is not a loosening is adding owners to a
 * rule line whose pattern and place stay as they were; blank lines and comments are ignored. Any other change (a rule
 * added, removed, moved or re-patterned, an owner removed) can hand a path to fewer or other owners, since the last
 * matching line wins. A deleted CODEOWNERS counts, and so does an added one: GitHub reads only the first CODEOWNERS it
 * finds (`.github/`, the root, `docs/`), so a new file can replace the one in force. A rule line with white space other
 * than a space or a tab in it (a no-break space, U+FEFF) may split into owners differently for GitHub than here, and a
 * line with U+0085, U+2028 or U+2029 in it may be two lines to GitHub, comment or not: such a line passes only when its
 * text is the same on both sides, at the same place. Nothing here returns file text.
 */

/** The fixed words of a CODEOWNERS loosening. */
export const CODEOWNERS_WIDENINGS = ["file added", "rules changed", "file deleted"] as const;
export type CodeownersWidening = (typeof CODEOWNERS_WIDENINGS)[number];

interface Rule {
  pattern: string;
  owners: Set<string>;
  /** The line without its comment, untrimmed. */
  raw: string;
  /** The line holds white space other than a space or a tab, so its tokens are not trusted. */
  opaque: boolean;
}

/** Where the comment of a line starts: the first `#` not right after a backslash; -1 when there is none. Linear. */
function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "#" && (i === 0 || line[i - 1] !== "\\")) return i;
  }
  return -1;
}

/** White space other than a space or a tab. */
const OTHER_SPACE = /[^\S \t]/;
/** The characters some readers break lines at besides CR and LF; this reader splits at CR and LF only. */
const OTHER_LINE_BREAK = /[\x85\u{2028}\u{2029}]/u;

/**
 * The rule lines of a CODEOWNERS text: comments (`#` not escaped) and blank lines dropped. A line with another line
 * break in it is kept whole as an opaque rule, even when it starts as a comment.
 */
function rulesOf(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (OTHER_LINE_BREAK.test(line)) {
      rules.push({ pattern: "", owners: new Set(), raw: line, opaque: true });
      continue;
    }
    const at = commentStart(line);
    const raw = at === -1 ? line : line.slice(0, at);
    const bare = raw.trim();
    if (bare === "") continue;
    const tokens = bare.split(/(?<!\\)\s+/);
    rules.push({
      pattern: tokens[0] as string,
      owners: new Set(tokens.slice(1).map((owner) => owner.toLowerCase())),
      raw,
      opaque: OTHER_SPACE.test(raw),
    });
  }
  return rules;
}

/** The loosenings of a CODEOWNERS file from base to head; null text is a file absent on that side. */
export function codeownersWidenings(base: string | null, head: string | null): CodeownersWidening[] {
  if (base === null && head === null) return [];
  if (base === null) return ["file added"];
  if (head === null) return ["file deleted"];
  const before = rulesOf(base);
  const after = rulesOf(head);
  if (before.length !== after.length) return ["rules changed"];
  for (let i = 0; i < before.length; i++) {
    const b = before[i] as Rule;
    const a = after[i] as Rule;
    if (a.opaque || b.opaque) {
      if (a.raw !== b.raw) return ["rules changed"];
      continue;
    }
    if (a.pattern !== b.pattern) return ["rules changed"];
    for (const owner of b.owners) if (!a.owners.has(owner)) return ["rules changed"];
  }
  return [];
}
