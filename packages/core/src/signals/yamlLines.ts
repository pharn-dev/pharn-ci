/** Longest part of one line the helpers read; the diff reader already cuts kept lines at this length. */
const MAX_LINE = 400;

/** The line without a trailing `# comment` (a `#` outside quotes that starts the line or follows a space), trimmed. */
export function stripComment(line: string): string {
  const text = line.slice(0, MAX_LINE);
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || text[i - 1] === " " || text[i - 1] === "\t")) {
      return text.slice(0, i).trim();
    }
  }
  return text.trim();
}

/** A scalar without one pair of matching surrounding quotes, trimmed. */
export function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2) {
    const first = text[0];
    if ((first === '"' || first === "'") && text[text.length - 1] === first) return text.slice(1, -1).trim();
  }
  return text;
}

/**
 * A scalar value as the config reader turns it into a string: a double-quoted value is decoded as a JSON string (so
 * `"\u0033\u0030"` is `30`), a single-quoted one has `''` read as `'`, anything else is the text as written. Trimmed.
 * A double-quoted value that is not a valid JSON string is returned as written.
 */
export function scalarText(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(text);
      return typeof decoded === "string" ? decoded.trim() : text;
    } catch {
      return text;
    }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'"))
    return text.slice(1, -1).replace(/''/g, "'").trim();
  return text;
}

/** The leading space count of a line. */
export function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

/**
 * `key: value` on one comment-free line (an optional `- ` before the key); the value is "" when the key stands alone.
 * The key may be quoted (`"threshold": 30`, `'exclude':`), as the config reader allows; it is returned unquoted.
 */
export function keyValue(line: string): { key: string; value: string; indent: number } | null {
  const text = stripComment(line);
  const match = /^(-\s+)?([A-Za-z0-9_.-]+|"[^"]*"|'[^']*')\s*:(?:\s+(.*))?$/.exec(text);
  if (match === null) return null;
  const rawKey = match[2] as string;
  return {
    key: rawKey.startsWith('"') || rawKey.startsWith("'") ? rawKey.slice(1, -1) : rawKey,
    value: (match[3] ?? "").trim(),
    indent: indentOf(line) + (match[1] === undefined ? 0 : match[1].length),
  };
}

/** The scalar of a `- item` line (comment stripped, unquoted), or null when the line is not a list item. */
export function listItem(line: string): string | null {
  const text = stripComment(line);
  if (!/^-\s+\S/.test(text)) return null;
  return unquote(text.slice(1));
}

/** The items of a one-line flow list `[a, "b"]` as trimmed unquoted strings, or null when the text is not one. */
export function flowItems(value: string): string[] | null {
  const text = value.trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return null;
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of text.slice(1, -1)) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(unquote(current));
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(unquote(current));
  return items.filter((item) => item !== "");
}
