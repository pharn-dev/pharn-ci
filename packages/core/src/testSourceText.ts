const CHUNK_UNITS = 8192;

/**
 * The text of a file's bytes, or null when the file is not text: it holds a 0x00 byte, or the bytes are not
 * well-formed UTF-8 (an overlong form, a surrogate U+D800 to U+DFFF, a code point past U+10FFFF, a truncated sequence
 * or a stray continuation byte). Otherwise the exact text: a byte order mark stays U+FEFF and CRLF stays CRLF.
 * Written by hand because core has no `TextDecoder`.
 */
export function decodeTestSourceText(bytes: Uint8Array): string | null {
  const units: number[] = [];
  const parts: string[] = [];
  const push = (unit: number) => {
    units.push(unit);
    if (units.length >= CHUNK_UNITS) {
      parts.push(String.fromCharCode(...units));
      units.length = 0;
    }
  };
  const continuation = (at: number): number => {
    const byte = bytes[at];
    return byte !== undefined && (byte & 0xc0) === 0x80 ? byte & 0x3f : -1;
  };
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i] as number;
    if (first === 0x00) return null;
    if (first < 0x80) {
      push(first);
      i += 1;
      continue;
    }
    let codePoint: number;
    let length: number;
    if (first >= 0xc2 && first <= 0xdf) {
      length = 2;
      codePoint = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      length = 3;
      codePoint = first & 0x0f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      length = 4;
      codePoint = first & 0x07;
    } else {
      return null;
    }
    for (let k = 1; k < length; k++) {
      const next = continuation(i + k);
      if (next < 0) return null;
      codePoint = (codePoint << 6) | next;
    }
    if (length === 3 && (codePoint < 0x800 || (codePoint >= 0xd800 && codePoint <= 0xdfff))) return null;
    if (length === 4 && (codePoint < 0x10000 || codePoint > 0x10ffff)) return null;
    if (codePoint >= 0x10000) {
      const offset = codePoint - 0x10000;
      push(0xd800 + (offset >> 10));
      push(0xdc00 + (offset & 0x3ff));
    } else {
      push(codePoint);
    }
    i += length;
  }
  parts.push(String.fromCharCode(...units));
  return parts.join("");
}
