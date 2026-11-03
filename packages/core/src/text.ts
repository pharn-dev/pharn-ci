/**
 * The characters untrusted text must not carry into `report.json` or the comment, as inclusive code-unit ranges: the
 * control characters (U+0000 to U+001F, U+007F to U+009F), the zero-width and directional marks (U+200B to U+200F),
 * the line and paragraph separators and the bidirectional embeddings and overrides (U+2028 to U+202E), the
 * bidirectional isolates (U+2066 to U+2069) and the byte order mark (U+FEFF). Each is a single UTF-16 code unit.
 */
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const unicodeEscape = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;
const classPart = ([from, to]: readonly [number, number]) =>
  from === to ? unicodeEscape(from) : `${unicodeEscape(from)}-${unicodeEscape(to)}`;

/** One character class of every range above, global. */
const UNSAFE_PATTERN = new RegExp(`[${UNSAFE_RANGES.map(classPart).join("")}]`, "g");

/** True when the UTF-16 code unit `code` is a control, invisible or bidirectional character (see `UNSAFE_RANGES`). */
export function isUnsafeCode(code: number): boolean {
  return UNSAFE_RANGES.some(([from, to]) => code >= from && code <= to);
}

/** True when the text holds a control, invisible or bidirectional character. */
export function hasUnsafeChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (isUnsafeCode(text.charCodeAt(i))) return true;
  return false;
}

/** The text with each control, invisible or bidirectional character replaced by `replacement`. */
export function replaceUnsafeChars(text: string, replacement: string): string {
  return text.replace(UNSAFE_PATTERN, replacement);
}

/**
 * Orders two strings by UTF-16 code unit, the order `Array.prototype.sort` uses without a comparator, as a three-way
 * comparator for `sort`. Never locale-aware, so the order is the same on every machine.
 */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True when the UTF-16 code unit `code` is a high (leading) surrogate. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The text cut to at most `limit` UTF-16 code units, never inside a surrogate pair. Text that already fits (length at
 * most `limit`) comes back as it is.
 *
 * By default a cut text ends with `…` and the `…` counts inside the limit: the kept text is at most `limit - 1` units,
 * one fewer when the cut would split a pair, so the result is at most `limit` units. With `{ marker: false }` there is
 * no `…`: the kept text is at most `limit` units, one fewer when the cut would split a pair.
 *
 * `limit` is clamped to 0 when negative. A limit of 0 keeps nothing: the cut text is `…` (one unit, the one case where
 * the result is longer than the limit) with the marker, and the empty string without it.
 */
export function cutCodeUnits(text: string, limit: number, options: { marker?: boolean } = {}): string {
  const max = Math.max(0, limit);
  if (text.length <= max) return text;
  const marker = options.marker ?? true;
  let end = marker ? Math.max(0, max - 1) : max;
  if (end > 0 && isHighSurrogate(text.charCodeAt(end - 1))) end--;
  return marker ? `${text.slice(0, end)}…` : text.slice(0, end);
}

/** The number of bytes of the text's UTF-8 encoding. A lone surrogate counts as three bytes (U+FFFD), a pair as four. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < n) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
