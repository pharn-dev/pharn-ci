/**
 * A minimal XML pull scanner for untrusted text. It knows nothing about any
 * particular format.
 *
 * One forward index walks the text once and reports start tags, end tags and
 * text runs in document order. It uses `indexOf` and per-character checks, never
 * a regular expression, and keeps no element stack, so hostile input costs time
 * proportional to its length and deep nesting costs nothing.
 *
 * Skipped without a report: a leading BOM, comments, CDATA sections (their
 * content is never reported, as text or as markup), processing instructions and
 * other `<!` declarations such as DOCTYPE (an internal subset degrades to
 * skipped declarations and ignored text). A skipped construct with no
 * terminator ends the scan: what precedes it was already reported, the rest is
 * ignored.
 *
 * A tag runs from `<` to the first `>` outside a quoted attribute value. A `<`
 * met inside a tag drops the broken tag and scanning resumes at that `<`; a tag
 * still open at the end of the text is dropped. Attribute values and text runs
 * are entity-decoded (see `decodeEntities`). Names are compared exactly, so a
 * prefixed name is simply a different name.
 */

export type XmlEvent =
  | { type: "start"; name: string; attrs: ReadonlyMap<string, string>; selfClosing: boolean }
  | { type: "end"; name: string }
  | { type: "text"; text: string };

const NO_ATTRS: ReadonlyMap<string, string> = new Map();

/** `;` must come within this many characters after `&`, which keeps decoding linear. */
const ENTITY_WINDOW = 10;

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isQuote(char: string): boolean {
  return char === '"' || char === "'";
}

/**
 * Decode the five predefined entities and decimal or hexadecimal numeric
 * references. Only valid code points are decoded; anything else stays literal.
 */
export function decodeEntities(text: string): string {
  let amp = text.indexOf("&");
  if (amp === -1) return text;
  let out = "";
  let from = 0;
  while (amp !== -1) {
    const decoded = decodeReference(text, amp);
    if (decoded === undefined) {
      amp = text.indexOf("&", amp + 1);
      continue;
    }
    out += text.slice(from, amp) + decoded.value;
    from = decoded.end;
    amp = text.indexOf("&", from);
  }
  return out + text.slice(from);
}

function decodeReference(text: string, amp: number): { value: string; end: number } | undefined {
  const limit = Math.min(text.length, amp + 1 + ENTITY_WINDOW);
  let semi = -1;
  for (let i = amp + 1; i < limit; i++) {
    if (text.charAt(i) === ";") {
      semi = i;
      break;
    }
  }
  if (semi === -1) return undefined;
  const body = text.slice(amp + 1, semi);
  const named = Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : undefined;
  if (named !== undefined) return { value: named, end: semi + 1 };
  if (body.charAt(0) !== "#") return undefined;
  const hex = body.charAt(1) === "x";
  const digits = body.slice(hex ? 2 : 1);
  if (digits === "") return undefined;
  let code = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = Number.parseInt(digits.charAt(i), hex ? 16 : 10);
    if (Number.isNaN(digit)) return undefined;
    code = code * (hex ? 16 : 10) + digit;
  }
  if (code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return undefined;
  return { value: String.fromCodePoint(code), end: semi + 1 };
}

/** Read a tag body (the text between `<` and `>`) into a start or end event, or undefined if it has no name. */
function parseTag(body: string): XmlEvent | undefined {
  if (body.charAt(0) === "/") {
    const name = readName(body, 1);
    return name === "" ? undefined : { type: "end", name };
  }
  let end = body.length;
  while (end > 0 && isSpace(body.charAt(end - 1))) end--;
  const selfClosing = end > 0 && body.charAt(end - 1) === "/";
  if (selfClosing) end--;
  const name = readName(body, 0);
  if (name === "") return undefined;
  return { type: "start", name, attrs: parseAttributes(body, name.length, end), selfClosing };
}

function readName(body: string, from: number): string {
  let i = from;
  while (i < body.length && !isSpace(body.charAt(i)) && body.charAt(i) !== "/") i++;
  return body.slice(from, i);
}

function parseAttributes(body: string, from: number, end: number): ReadonlyMap<string, string> {
  let attrs: Map<string, string> | undefined;
  let i = from;
  while (i < end) {
    while (i < end && isSpace(body.charAt(i))) i++;
    const nameStart = i;
    while (i < end && !isSpace(body.charAt(i)) && body.charAt(i) !== "=") i++;
    const name = body.slice(nameStart, i);
    while (i < end && isSpace(body.charAt(i))) i++;
    if (body.charAt(i) !== "=" || i >= end) {
      // A value-less attribute: skip it.
      continue;
    }
    i++;
    while (i < end && isSpace(body.charAt(i))) i++;
    const quote = body.charAt(i);
    if (!isQuote(quote) || i >= end) {
      // An unquoted value: skip the token.
      while (i < end && !isSpace(body.charAt(i))) i++;
      continue;
    }
    const close = body.indexOf(quote, i + 1);
    if (close === -1 || close >= end) break;
    if (name !== "") {
      attrs ??= new Map();
      if (!attrs.has(name)) attrs.set(name, decodeEntities(body.slice(i + 1, close)));
    }
    i = close + 1;
  }
  return attrs ?? NO_ATTRS;
}

/** End of a `<!` declaration: the first `>` outside quotes, or -1. */
function findDeclarationEnd(text: string, from: number): number {
  let quote = "";
  for (let i = from; i < text.length; i++) {
    const char = text.charAt(i);
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (isQuote(char)) {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * End of an ordinary tag starting at `start` (the index of `<`): the index of
 * its `>`; -1 when the text ends first; or `-(index of a '<') - 2` when a `<`
 * inside the tag breaks it, which tells the caller where to resume.
 */
function findTagEnd(text: string, start: number): number {
  let quote = "";
  for (let i = start + 1; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === "<") return -i - 2;
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (isQuote(char)) {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

export function scanXml(text: string, onEvent: (event: XmlEvent) => void): void {
  const length = text.length;
  // A leading byte order mark (U+FEFF) is skipped.
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (pos < length) {
    const lt = text.indexOf("<", pos);
    const textEnd = lt === -1 ? length : lt;
    if (textEnd > pos) onEvent({ type: "text", text: decodeEntities(text.slice(pos, textEnd)) });
    if (lt === -1) return;

    const next = text.charAt(lt + 1);
    if (next === "<") {
      // A bare `<` followed by another: drop it and resume there.
      pos = lt + 1;
    } else if (next === "!" && text.startsWith("<!--", lt)) {
      const close = text.indexOf("-->", lt + 4);
      if (close === -1) return;
      pos = close + 3;
    } else if (next === "!" && text.startsWith("<![CDATA[", lt)) {
      const close = text.indexOf("]]>", lt + 9);
      if (close === -1) return;
      pos = close + 3;
    } else if (next === "?") {
      const close = text.indexOf("?>", lt + 2);
      if (close === -1) return;
      pos = close + 2;
    } else if (next === "!") {
      const close = findDeclarationEnd(text, lt + 2);
      if (close === -1) return;
      pos = close + 1;
    } else {
      const close = findTagEnd(text, lt);
      if (close === -1) return;
      if (close < -1) {
        pos = -close - 2;
        continue;
      }
      const event = parseTag(text.slice(lt + 1, close));
      if (event !== undefined) onEvent(event);
      pos = close + 1;
    }
  }
}
