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
