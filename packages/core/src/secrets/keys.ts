// The helpers behind the S10 and S11 rules: what a secret-named key is, what a value that is not a secret looks like,
// and a single-pass reader for the eight key/value forms of agent config files. Everything here starts from a literal
// anchor (a separator or `--`) and reads a bounded stretch of text around it, so a long one-line input costs a bounded
// amount of work per anchor.

/** The longest key (in characters) read backwards from a separator. */
const MAX_KEY_CHARS = 128;
/** The longest value (in characters) read forwards from a separator. */
const MAX_VALUE_CHARS = 4096;
/** The most spaces or tabs skipped between a key, its separator and its value. */
const MAX_GAP_CHARS = 16;

const SECRET_WORDS: ReadonlySet<string> = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "auth",
  "authorization",
  "apikey",
]);

/** A superset test: a key with none of these fragments, in any case, names no secret. */
const SECRET_FRAGMENT = /token|secret|pass|auth|api/i;

const isUpper = (c: string | undefined): boolean => c !== undefined && c >= "A" && c <= "Z";
const isLower = (c: string | undefined): boolean => c !== undefined && c >= "a" && c <= "z";
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

/** The offsets of the words of a key as `[start, end, start, end, ...]`; see `secretKeyWords` for the splitting rules. */
function wordBounds(key: string): number[] {
  const bounds: number[] = [];
  let start = -1;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code === 95 || code === 45 || code === 46 || code === 32) {
      if (start !== -1) bounds.push(start, i);
      start = -1;
      continue;
    }
    if (start === -1) {
      start = i;
      continue;
    }
    const c = key[i];
    if (isUpper(c)) {
      const prev = key[i - 1];
      if (isLower(prev) || isDigit(prev) || (isUpper(prev) && isLower(key[i + 1]))) {
        bounds.push(start, i);
        start = i;
      }
    }
  }
  if (start !== -1) bounds.push(start, key.length);
  return bounds;
}

/**
 * The lower-case words of a key: split on `_`, `-`, `.` and spaces, and at camelCase boundaries (`apiKey` is `api` and
 * `key`; `APIKey` is `api` and `key`; `AUTH_TOKEN` is `auth` and `token`).
 */
export function secretKeyWords(key: string): string[] {
  const bounds = wordBounds(key);
  const words: string[] = [];
  for (let i = 0; i < bounds.length; i += 2) words.push(key.slice(bounds[i], bounds[i + 1]).toLowerCase());
  return words;
}

/** The longest secret word (`authorization`), in characters. */
const MAX_SECRET_WORD_CHARS = 13;

/**
 * Whether a key names a secret: its whole words include `token`, `secret`, `password`, `passwd`, `auth`,
 * `authorization` or `apikey`, or `api` directly followed by `key`. `author` is not `auth`.
 */
export function isSecretKey(key: string): boolean {
  // Every secret word (and `api` + `key`) contains one of these fragments, so most keys are rejected without a split.
  if (!SECRET_FRAGMENT.test(key)) return false;
  const bounds = wordBounds(key);
  for (let i = 0; i < bounds.length; i += 2) {
    const length = (bounds[i + 1] as number) - (bounds[i] as number);
    if (length < 3 || length > MAX_SECRET_WORD_CHARS) continue;
    const word = key.slice(bounds[i], bounds[i + 1]).toLowerCase();
    if (SECRET_WORDS.has(word)) return true;
    if (word === "api" && i + 3 < bounds.length && key.slice(bounds[i + 2], bounds[i + 3]).toLowerCase() === "key")
      return true;
  }
  return false;
}

/**
 * Whether a value reads another place for its content: it holds `${`, starts with `$` and a letter, `{` or `(`, is
 * `%VAR%`, or starts with `{env:` or `{file:`.
 */
export function isEnvReference(value: string): boolean {
  if (value.includes("${")) return true;
  if (value.startsWith("{env:") || value.startsWith("{file:")) return true;
  if (value.startsWith("$")) {
    const next = value[1];
    if (next === "{" || next === "(" || isUpper(next) || isLower(next)) return true;
  }
  return /^%[A-Za-z_][A-Za-z0-9_]*%$/.test(value);
}

/** Whether a value is a URL: a scheme, then `://`. */
export function isUrlValue(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

/** Whether a value is a file path: it starts with `/`, `./`, `../` or `~/`. */
export function isPathValue(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("~/");
}

/** The Shannon entropy of a text, in bits per character (UTF-16 unit). 0 for the empty text. */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** One key and its value in a text; the offsets are UTF-16 offsets, and the value is without its quotes. */
export interface KeyValue {
  key: string;
  keyStart: number;
  keyEnd: number;
  value: string;
  valueStart: number;
  valueEnd: number;
  quoted: boolean;
}

const isKeyChar = (c: string | undefined): boolean =>
  c !== undefined && (isUpper(c) || isLower(c) || isDigit(c) || c === "_" || c === "." || c === "-");
const isBlank = (c: string | undefined): boolean => c === " " || c === "\t";
const isQuote = (c: string | undefined): boolean => c === '"' || c === "'";
const isLineBreak = (c: string | undefined): boolean => c === "\n" || c === "\r";

/** The characters that end a bare (unquoted) value, besides the end of the text and of the line. */
const BARE_STOPS: ReadonlySet<string> = new Set([" ", "\t", ",", ";", "#", "}", '"', "'"]);

/** The value that starts at `from` (blanks already skipped), or null when there is none. */
function readValue(text: string, from: number): { value: string; start: number; end: number; quoted: boolean } | null {
  const first = text[from];
  if (first === undefined || isLineBreak(first)) return null;
  if (isQuote(first)) {
    const limit = Math.min(text.length, from + 1 + MAX_VALUE_CHARS);
    for (let i = from + 1; i < limit; i++) {
      const c = text[i];
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === first) return { value: text.slice(from + 1, i), start: from + 1, end: i, quoted: true };
      if (isLineBreak(c)) return null;
    }
    return null;
  }
  if (first === "=" || first === ":") return null;
  const limit = Math.min(text.length, from + MAX_VALUE_CHARS);
  let end = from;
  while (end < limit) {
    const c = text[end] as string;
    if (BARE_STOPS.has(c) || isLineBreak(c)) break;
    end++;
  }
  if (end === from) return null;
  return { value: text.slice(from, end), start: from, end, quoted: false };
}

/** The offset of the first character after the blanks that start at `from`. */
function skipBlanks(text: string, from: number): number {
  let i = from;
  const limit = Math.min(text.length, from + MAX_GAP_CHARS);
  while (i < limit && isBlank(text[i])) i++;
  return i;
}

const isKeyCode = (c: number): boolean =>
  (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 46 || c === 45;
const isBlankCode = (c: number): boolean => c === 32 || c === 9;
const isQuoteCode = (c: number): boolean => c === 34 || c === 39;

/** The key that ends just before the separator at `at`: its text and offsets, or null when there is none. */
function readKeyBefore(text: string, at: number): { key: string; start: number; end: number } | null {
  let j = at - 1;
  const gapLimit = Math.max(-1, j - MAX_GAP_CHARS);
  while (j > gapLimit && isBlankCode(text.charCodeAt(j))) j--;
  let quote = -1;
  if (j >= 0 && isQuoteCode(text.charCodeAt(j))) {
    quote = text.charCodeAt(j);
    j--;
  }
  const end = j + 1;
  const keyLimit = Math.max(-1, j - MAX_KEY_CHARS);
  while (j > keyLimit && isKeyCode(text.charCodeAt(j))) j--;
  const start = j + 1;
  if (start === end) return null;
  if (quote !== -1 && (j < 0 || text.charCodeAt(j) !== quote)) return null;
  return { key: text.slice(start, end), start, end };
}

/**
 * Every key and value in `text` whose key is a secret-named key, in the eight forms: `"key": "v"`, `key: v`,
 * `key = "v"`, `KEY=v`, `export KEY="v"`, `--key=v`, `--key v` and the JSON argument pair `"--key", "v"`. A bare value
 * ends at whitespace, `,`, `;`, `#`, `}`, a quote or the end of the line, so it never holds a space. The walk is one pass
 * over the text from the separator anchors (`:`, `=` and `--`); the key is read backwards and the value forwards with
 * bounded loops, and the separators inside a bare value are not read again.
 */
export function secretKeyValues(text: string): KeyValue[] {
  const found: KeyValue[] = [];
  let skipUntil = 0;
  for (let i = 0; i < text.length; i++) {
    if (i < skipUntil) continue;
    const code = text.charCodeAt(i);
    if (code !== 58 && code !== 61 && code !== 45) continue;
    if (code !== 45) {
      const key = readKeyBefore(text, i);
      if (key === null || !isSecretKey(key.key)) continue;
      const value = readValue(text, skipBlanks(text, i + 1));
      if (value === null) continue;
      found.push({
        key: key.key,
        keyStart: key.start,
        keyEnd: key.end,
        value: value.value,
        valueStart: value.start,
        valueEnd: value.end,
        quoted: value.quoted,
      });
      if (!value.quoted) skipUntil = value.end;
    } else if (text.charCodeAt(i + 1) === 45 && !isKeyChar(text[i - 1])) {
      let nameEnd = i + 2;
      const nameLimit = Math.min(text.length, i + 2 + MAX_KEY_CHARS);
      while (nameEnd < nameLimit && isKeyChar(text[nameEnd])) nameEnd++;
      if (nameEnd === i + 2) continue;
      const key = text.slice(i, nameEnd);
      if (!isSecretKey(key)) continue;
      let p = nameEnd;
      if (isQuote(text[p])) p++;
      let separated = false;
      if (text[p] === ",") {
        separated = true;
        p++;
      }
      const afterBlanks = skipBlanks(text, p);
      if (afterBlanks > p) separated = true;
      p = afterBlanks;
      // `--key=v` and `"--key": "v"` are the separator anchors' forms.
      if (!separated || text[p] === "=" || text[p] === ":") continue;
      const value = readValue(text, p);
      if (value === null || (!value.quoted && value.value.startsWith("--"))) continue;
      found.push({
        key,
        keyStart: i,
        keyEnd: nameEnd,
        value: value.value,
        valueStart: value.start,
        valueEnd: value.end,
        quoted: value.quoted,
      });
      if (!value.quoted) skipUntil = value.end;
    }
  }
  return found;
}
