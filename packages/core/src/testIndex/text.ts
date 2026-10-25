import { MAX_TEST_NAME_CHARS } from "./types.js";

/** Every run of JavaScript whitespace becomes one space. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** A name, or a path entry built from one, cut to 500 UTF-16 code units. */
export function cutName(name: string): string {
  return name.length > MAX_TEST_NAME_CHARS ? name.slice(0, MAX_TEST_NAME_CHARS) : name;
}

/**
 * A stretch of the file that is not code the comment scan may read: `verbatim` is kept exactly (string and template
 * literal tokens); `shielded` keeps the whitespace collapse but is never read for comments (regular expression
 * literals and JSX text).
 */
export interface LiteralRange {
  start: number;
  end: number;
  kind: "verbatim" | "shielded";
}

/** The characters JavaScript's `\s` matches. */
function isJsSpace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/**
 * The whole file with each comment replaced by one space and every run of whitespace outside verbatim ranges
 * collapsed to one space, in one pass. `map[i]` is the length of the output before original offset `i` (and
 * `map[text.length]` the full length), so any original slice maps to a slice of the output. Ranges must be sorted by
 * start; one that overlaps the previous or is empty is ignored.
 */
export function normalizeFile(text: string, ranges: readonly LiteralRange[]): { normalized: string; map: Int32Array } {
  const n = text.length;
  const map = new Int32Array(n + 1);
  let out = "";
  let outLength = 0;
  let lastWasSpace = false;
  const clean: LiteralRange[] = [];
  let previousEnd = 0;
  for (const r of ranges) {
    if (r.start >= previousEnd && r.end > r.start) {
      clean.push(r);
      previousEnd = r.end;
    }
  }
  let rangeIndex = 0;
  const emit = (piece: string): void => {
    out += piece;
    outLength += piece.length;
  };
  /** One space for the original stretch [from, to), unless the output already ends in one. */
  const space = (from: number, to: number): void => {
    map[from] = outLength;
    if (!lastWasSpace) {
      emit(" ");
      lastWasSpace = true;
    }
    for (let k = from + 1; k < to; k++) map[k] = outLength;
  };

  let i = 0;
  while (i < n) {
    let range = clean[rangeIndex];
    while (range !== undefined && range.end <= i) {
      rangeIndex++;
      range = clean[rangeIndex];
    }
    const inRange = range !== undefined && range.start <= i;
    if (range !== undefined && inRange && range.kind === "verbatim") {
      const end = Math.min(range.end, n);
      for (let k = i; k < end; k++) map[k] = outLength + (k - i);
      emit(text.slice(i, end));
      lastWasSpace = false;
      i = end;
      continue;
    }
    const code = text.charCodeAt(i);
    if (!inRange && code === 47) {
      const next = text.charCodeAt(i + 1);
      if (next === 47) {
        let j = i + 2;
        while (j < n && !isLineTerminator(text.charCodeAt(j))) j++;
        space(i, j);
        i = j;
        continue;
      }
      if (next === 42) {
        const close = text.indexOf("*/", i + 2);
        const j = close === -1 ? n : close + 2;
        space(i, j);
        i = j;
        continue;
      }
    }
    if (isJsSpace(code)) {
      space(i, i + 1);
    } else {
      map[i] = outLength;
      emit(text[i] as string);
      lastWasSpace = false;
    }
    i++;
  }
  map[n] = outLength;
  return { normalized: out, map };
}

/** The normalized text for the original slice [start, end), without the one-space ends. */
export function bodySlice(normalized: string, map: Int32Array, start: number, end: number): string {
  let body = normalized.slice(map[start] ?? 0, map[end] ?? normalized.length);
  if (body.startsWith(" ")) body = body.slice(1);
  if (body.endsWith(" ")) body = body.slice(0, -1);
  return body;
}
