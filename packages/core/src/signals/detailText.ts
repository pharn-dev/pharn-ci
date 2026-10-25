/**
 * Text from a diff that reaches a signal detail is written in printable ASCII only: each UTF-16 code unit from U+0020 to
 * U+007E stands for itself, except the backslash and the double quote, which are written with a backslash in front.
 * Every other code unit becomes a backslash, `u` and four lower-case hex digits. Both helpers scan once from left to
 * right, so the time is linear in the text.
 */

/** The escape of one UTF-16 code unit. */
function escapeUnit(text: string, index: number): string {
  const char = text.charAt(index);
  if (char === "\\") return "\\\\";
  if (char === '"') return '\\"';
  const unit = text.charCodeAt(index);
  if (unit >= 0x20 && unit <= 0x7e) return char;
  return `\\u${unit.toString(16).padStart(4, "0")}`;
}

/** `text` with every code unit written as printable ASCII (see the module comment). */
export function escapeDetailText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += escapeUnit(text, i);
  return out;
}

/**
 * The escaped text of `text` when it is at most `max` characters long. Otherwise whole escaped code units are appended
 * while they fit in `max - 3` characters, then `...` (three ASCII dots), so an escape is never split and the result
 * never passes `max`.
 */
export function quoteLiteral(text: string, max = 60): string {
  const whole = escapeDetailText(text);
  if (whole.length <= max) return whole;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const piece = escapeUnit(text, i);
    if (out.length + piece.length > max - 3) break;
    out += piece;
  }
  return `${out}...`;
}
