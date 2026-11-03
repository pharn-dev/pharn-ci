import { utf8ByteLength } from "../text.js";
import { findSecretSpans } from "./spans.js";

/** The default byte budget of a message after redaction. */
export const MESSAGE_MAX_BYTES = 2048;

/** The least byte budget `truncateUtf8` accepts: the longest `…[+N bytes]` suffix fits in it. */
const MIN_BUDGET_BYTES = 32;
/** The bytes of the suffix `…[+N bytes]` besides the digits of N: the ellipsis (3), `[+` (2) and ` bytes]` (7). */
const SUFFIX_FIXED_BYTES = 12;

/**
 * `text` with each secret replaced by `[redacted:S0x]` (its own id for S01 to S09) or `[redacted]` (S10). Text outside
 * the spans is kept as it is.
 */
export function redactSecrets(text: string): string {
  const spans = findSecretSpans(text).sort((a, b) => b.start - a.start);
  let out = text;
  for (const span of spans) {
    const marker = span.id === "S10" ? "[redacted]" : `[redacted:${span.id}]`;
    out = out.slice(0, span.start) + marker + out.slice(span.end);
  }
  return out;
}

const digitsOf = (n: number): number => String(n).length;

/**
 * `text` as it is when it fits in `maxBytes` of UTF-8; otherwise the longest prefix, cut at a code-point boundary, that
 * fits together with the suffix `…[+N bytes]`, where N is the number of bytes dropped. A surrogate pair is never split,
 * and a lone surrogate counts 3 bytes. Throws a RangeError unless `maxBytes` is a safe integer of at least 32.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MIN_BUDGET_BYTES) {
    throw new RangeError(`maxBytes must be a safe integer of at least ${MIN_BUDGET_BYTES}`);
  }
  const total = utf8ByteLength(text);
  if (total <= maxBytes) return text;
  // The cost of keeping a prefix of b bytes never falls as b grows (a code point adds at least one byte, and the digits
  // of the dropped count fall by at most one), so the first prefix that does not fit ends the search.
  let keepUnits = 0;
  let keepBytes = 0;
  for (let i = 0; i < text.length; ) {
    // A surrogate pair is one code point of two units; a lone surrogate or any other unit is one.
    const units = (text.codePointAt(i) as number) > 0xffff ? 2 : 1;
    const bytes = keepBytes + utf8ByteLength(text.slice(i, i + units));
    if (bytes + SUFFIX_FIXED_BYTES + digitsOf(total - bytes) > maxBytes) break;
    keepBytes = bytes;
    i += units;
    keepUnits = i;
  }
  return `${text.slice(0, keepUnits)}…[+${total - keepBytes} bytes]`;
}

/** `truncateUtf8(redactSecrets(text), maxBytes)`: a secret is redacted before the cut, so none survives a cut. */
export function redactMessage(text: string, maxBytes: number = MESSAGE_MAX_BYTES): string {
  return truncateUtf8(redactSecrets(text), maxBytes);
}
