/**
 * PI01: invisible and bidirectional Unicode in an added line, found by code point checks (a fixed table and a few
 * Unicode property tests of single code points), never by a regex over the line. A finding names the character's
 * fixed name and code point, never the text around it.
 */

/** The fixed names of the characters PI01 flags, by code point. Tag characters are named as a block. */
const NAMES: ReadonlyMap<number, string> = new Map([
  [0x00ad, "soft hyphen"],
  [0x061c, "Arabic letter mark"],
  [0x180e, "Mongolian vowel separator"],
  [0x200b, "zero-width space"],
  [0x200c, "zero-width non-joiner"],
  [0x200d, "zero-width joiner"],
  [0x200e, "left-to-right mark"],
  [0x200f, "right-to-left mark"],
  [0x202a, "left-to-right embedding"],
  [0x202b, "right-to-left embedding"],
  [0x202c, "pop directional formatting"],
  [0x202d, "left-to-right override"],
  [0x202e, "right-to-left override"],
  [0x2060, "word joiner"],
  [0x2061, "invisible function application"],
  [0x2062, "invisible times"],
  [0x2063, "invisible separator"],
  [0x2064, "invisible plus"],
  [0x2066, "left-to-right isolate"],
  [0x2067, "right-to-left isolate"],
  [0x2068, "first strong isolate"],
  [0x2069, "pop directional isolate"],
  [0xfeff, "zero-width no-break space"],
]);

const TAG_FIRST = 0xe0000;
const TAG_LAST = 0xe007f;
const TAG_CANCEL = 0xe007f;
const WAVING_BLACK_FLAG = 0x1f3f4;

const LETTER = /^\p{L}$/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const LATIN = /^\p{Script=Latin}$/u;
const EMOJI_PART = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]$/u;

/** One PI01 finding of a line: the first flagged character's name and code point, and how many were flagged. */
export interface InvisibleFinding {
  /** For example `right-to-left override U+202E`. */
  first: string;
  count: number;
}

export interface InvisibleOptions {
  /** True for the first added line of a file that starts at line 1: a U+FEFF at its very start is a byte order mark. */
  bomAllowed: boolean;
  /** True in a locale file: the directional marks (U+200E, U+200F, U+061C) and the soft hyphen are legitimate there. */
  locale: boolean;
}

/** `U+XXXX` with at least four upper-case hex digits. */
export function codePointName(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Whether a code point is a letter of a right-to-left script block (Hebrew, Arabic, Syriac, Thaana, NKo and their
 * extensions). The format characters of those blocks (the Arabic letter mark among them) are not letters.
 */
export function isRtlLetter(cp: number): boolean {
  const inBlock =
    (cp >= 0x0590 && cp <= 0x08ff) ||
    (cp >= 0xfb1d && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfefc) ||
    (cp >= 0x10800 && cp <= 0x10fff) ||
    (cp >= 0x1e800 && cp <= 0x1efff);
  return inBlock && test(LETTER, cp);
}

function test(pattern: RegExp, cp: number | undefined): boolean {
  return cp !== undefined && pattern.test(String.fromCodePoint(cp));
}

/** A letter or combining mark of a script other than Latin (Arabic, Devanagari, ...): ZWNJ and ZWJ shape those. */
function isNonLatinLetterOrMark(cp: number | undefined): boolean {
  return test(LETTER_OR_MARK, cp) && !test(LATIN, cp);
}

/** A part of an emoji sequence: a pictograph, a skin-tone modifier, a regional indicator or variation selector 16. */
function isEmojiPart(cp: number | undefined): boolean {
  return cp === 0xfe0f || test(EMOJI_PART, cp);
}

/**
 * Whether a ZWNJ or ZWJ between `prev` and `next` is legitimate: between two letters or marks of a non-Latin script
 * (Persian, Indic shaping), or between two parts of an emoji ZWJ sequence.
 */
function joinerAllowed(prev: number | undefined, next: number | undefined): boolean {
  if (prev === undefined || next === undefined) return false;
  if (isNonLatinLetterOrMark(prev) && isNonLatinLetterOrMark(next)) return true;
  return isEmojiPart(prev) && isEmojiPart(next);
}

/** The PI01 finding of one added line, or null when it carries no flagged character. Linear in the line. */
export function scanInvisible(text: string, options: InvisibleOptions): InvisibleFinding | null {
  // A quick pass: most lines are ASCII and hold nothing to check.
  let any = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 0xad) {
      any = true;
      break;
    }
  }
  if (!any) return null;
  const cps = Array.from(text, (ch) => ch.codePointAt(0) as number);
  let rtl: boolean | undefined;
  const lineHasRtl = (): boolean => {
    if (rtl === undefined) rtl = cps.some(isRtlLetter);
    return rtl;
  };
  let first: string | null = null;
  let count = 0;
  const flag = (name: string): void => {
    if (first === null) first = name;
    count++;
  };
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i] as number;
    if (cp === WAVING_BLACK_FLAG) {
      // A subdivision flag: U+1F3F4, tag characters U+E0020 to U+E007E, then the cancel tag U+E007F.
      let j = i + 1;
      while (j < cps.length && (cps[j] as number) >= 0xe0020 && (cps[j] as number) <= 0xe007e) j++;
      if (j > i + 1 && cps[j] === TAG_CANCEL) i = j;
      continue;
    }
    if (cp >= TAG_FIRST && cp <= TAG_LAST) {
      flag(`tag character ${codePointName(TAG_FIRST)}-${codePointName(TAG_LAST)}`);
      continue;
    }
    const name = NAMES.get(cp);
    if (name === undefined) continue;
    if (cp === 0xfeff && i === 0 && options.bomAllowed) continue;
    if (cp === 0x200c || cp === 0x200d) {
      if (joinerAllowed(cps[i - 1], cps[i + 1])) continue;
    } else if (cp === 0x200e || cp === 0x200f || cp === 0x061c) {
      if (options.locale || lineHasRtl()) continue;
    } else if (cp === 0x00ad) {
      if (options.locale) continue;
    }
    flag(`${name} ${codePointName(cp)}`);
  }
  return first === null ? null : { first, count };
}
