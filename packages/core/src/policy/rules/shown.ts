/** The longest pattern a detail shows, in UTF-16 code units. */
const MAX_SHOWN = 80;

/** The pattern as it is, or its first 79 code units (not inside a surrogate pair) and `…`. */
export function shownPattern(pattern: string): string {
  if (pattern.length <= MAX_SHOWN) return pattern;
  const high = pattern.charCodeAt(MAX_SHOWN - 2);
  const end = high >= 0xd800 && high <= 0xdbff ? MAX_SHOWN - 2 : MAX_SHOWN - 1;
  return `${pattern.slice(0, end)}…`;
}
