import { replaceUnsafeChars } from "../../text.js";

/** The longest pattern a detail shows, in UTF-16 code units. */
const MAX_SHOWN = 80;

/**
 * The pattern with each control, invisible or bidirectional character (see text.ts) replaced by U+FFFD, one code unit
 * for one, then as it is or its first 79 code units (not inside a surrogate pair) and `…`.
 */
export function shownPattern(text: string): string {
  const pattern = replaceUnsafeChars(text, "�");
  if (pattern.length <= MAX_SHOWN) return pattern;
  const high = pattern.charCodeAt(MAX_SHOWN - 2);
  const end = high >= 0xd800 && high <= 0xdbff ? MAX_SHOWN - 2 : MAX_SHOWN - 1;
  return `${pattern.slice(0, end)}…`;
}
