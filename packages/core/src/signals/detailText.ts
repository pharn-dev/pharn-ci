/**
 * Text from a diff that reaches a signal detail is written in printable ASCII only: each UTF-16 code unit from U+0020 to
 * U+007E stands for itself, except the backslash and the double quote, which are written with a backslash in front.
 * Every other code unit becomes a backslash, `u` and four lower-case hex digits. The helper scans once from left to
 * right, so the time is linear in the text. It is for paths only: no literal or other line text reaches a detail.
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
