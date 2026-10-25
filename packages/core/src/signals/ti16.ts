import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { testLanguage } from "./testLines.js";

// The marker words are built from parts, so that this file and the bundle built from it hold no marker after a comment
// opener (as `ti13.ts` does for its hints).
const SLASH = "/";
const STAR = "*";
const HASH = "#";
const LINE_OPENER = `${SLASH}${SLASH}`;
const BLOCK_OPENER = `${SLASH}${STAR}`;
const BLOCK_CLOSER = `${STAR}${SLASH}`;
const ESLINT = ["es", "lint-dis", "able"].join("");
const OXLINT = ["ox", "lint-dis", "able"].join("");
const BIOME = ["bio", "me-ig", "nore"].join("");
const TS = ["@", "ts-"].join("");

/** The comment words that switch a JavaScript or TypeScript linter or type checker off, matched case-sensitively. */
const JS_MARKERS: ReadonlySet<string> = new Set([
  ESLINT,
  `${ESLINT}-line`,
  `${ESLINT}-next-line`,
  `${TS}ignore`,
  `${TS}expect-error`,
  `${TS}nocheck`,
  BIOME,
  `${BIOME}-all`,
  `${BIOME}-start`,
  `${BIOME}-end`,
  OXLINT,
  `${OXLINT}-line`,
  `${OXLINT}-next-line`,
]);

const TYPE_WORD = ["ty", "pe:"].join("");
const IGNORE_WORD = ["ig", "nore"].join("");
const NOQA_WORD = ["no", "qa"].join("");
const PYLINT_WORD = ["py", "lint:"].join("");
const DISABLE_WORD = ["dis", "able"].join("");
const PYRIGHT_WORD = ["py", "right:"].join("");

/** The most characters of a kept line that are read (the diff reader already cuts lines at 400). */
const MAX_LINE = 400;

const isBlank = (c: string): boolean => c === " " || c === "\t";
const isWordChar = (c: string): boolean =>
  (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
const isTokenChar = (c: string): boolean => isWordChar(c) || c === "@" || c === "-";

/** Whether the text from `at` is the end of the line or a character that is not a word character. */
const endsWord = (text: string, at: number): boolean => at >= text.length || !isWordChar(text.charAt(at));

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

function skipBlanks(text: string, from: number): number {
  let i = from;
  while (i < text.length && isBlank(text.charAt(i))) i++;
  return i;
}

/**
 * The normalized text of the JavaScript or TypeScript marker that the first `//` or `/*` opener carrying one starts on
 * this line, from the marker word to the end of the comment (`*` and `/` for a block comment, else the end of the
 * line); null when no opener carries a marker.
 */
function jsMarker(text: string): string | null {
  for (let i = 0; i + 1 < text.length; i++) {
    if (text.charAt(i) !== SLASH) continue;
    const opener = text.slice(i, i + 2);
    if (opener !== LINE_OPENER && opener !== BLOCK_OPENER) continue;
    const start = skipBlanks(text, i + 2);
    let end = start;
    while (end < text.length && isTokenChar(text.charAt(end))) end++;
    if (!JS_MARKERS.has(text.slice(start, end))) continue;
    let stop = text.length;
    if (opener === BLOCK_OPENER) {
      const close = text.indexOf(BLOCK_CLOSER, end);
      if (close !== -1) stop = close;
    }
    return normalize(text.slice(start, stop));
  }
  return null;
}

/** Whether the Python comment text from `at` (just after the hash and blanks) starts a linter or type-checker marker. */
function startsPythonMarker(text: string, at: number): boolean {
  if (text.startsWith(TYPE_WORD, at)) {
    const word = skipBlanks(text, at + TYPE_WORD.length);
    return text.startsWith(IGNORE_WORD, word) && endsWord(text, word + IGNORE_WORD.length);
  }
  if (text.slice(at, at + NOQA_WORD.length).toLowerCase() === NOQA_WORD) {
    const next = at + NOQA_WORD.length;
    return next >= text.length || text.charAt(next) === ":" || !isWordChar(text.charAt(next));
  }
  if (text.startsWith(PYLINT_WORD, at)) {
    const word = skipBlanks(text, at + PYLINT_WORD.length);
    for (const name of [`${DISABLE_WORD}-next`, DISABLE_WORD]) {
      if (!text.startsWith(name, word)) continue;
      const next = word + name.length;
      if (next >= text.length || text.charAt(next) === "=" || !isWordChar(text.charAt(next))) return true;
    }
    return false;
  }
  if (text.startsWith(PYRIGHT_WORD, at)) {
    const word = skipBlanks(text, at + PYRIGHT_WORD.length);
    return text.startsWith(IGNORE_WORD, word) && endsWord(text, word + IGNORE_WORD.length);
  }
  return false;
}

/** The normalized text of the Python marker that the first hash carrying one starts on this line, to the end of the line. */
function pythonMarker(text: string): string | null {
  for (let i = text.indexOf(HASH); i !== -1; i = text.indexOf(HASH, i + 1)) {
    const start = skipBlanks(text, i + 1);
    if (startsPythonMarker(text, start)) return normalize(text.slice(start));
  }
  return null;
}

const markerOf = (text: string, language: "jsts" | "python"): string | null => {
  const line = text.length > MAX_LINE ? text.slice(0, MAX_LINE) : text;
  return language === "jsts" ? jsMarker(line) : pythonMarker(line);
};

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * TI16, a lint or type suppression comment added to a test file; always severity `info`. In a JavaScript, TypeScript or
 * Python test file (not Go) with kept text, an added line carries a marker when a `//` or `/*` opener (a hash in
 * Python) is followed by a marker word of that language. The marker text is the comment from the marker word to its end,
 * with white space collapsed. Each added marker line, in ascending line order, takes one removed marker line of the
 * same file with equal text when one is left (an unchanged or respaced move); the others are fresh. A file with at
 * least one fresh marker gives one signal at the line of the first, whose fixed detail holds the count and no comment
 * text.
 */
export function detectTI16(diff: readonly DiffFile[]): TestIntegritySignal[] {
  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || !isTestFile(file.path)) continue;
    const language = testLanguage(file.path);
    if (language !== "jsts" && language !== "python") continue;

    const removed = new Map<string, number>();
    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) {
        const marker = markerOf(entry.text, language);
        if (marker !== null) removed.set(marker, (removed.get(marker) ?? 0) + 1);
      }
    }
    const added: Array<{ line: number; marker: string }> = [];
    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        const marker = markerOf(entry.text, language);
        if (marker !== null) added.push({ line: entry.line, marker });
      }
    }
    added.sort((a, b) => a.line - b.line);

    const fresh: number[] = [];
    for (const entry of added) {
      const left = removed.get(entry.marker) ?? 0;
      if (left > 0) removed.set(entry.marker, left - 1);
      else fresh.push(entry.line);
    }
    if (fresh.length === 0) continue;
    const count = fresh.length === 1 ? "1 comment" : `${fresh.length} comments`;
    signals.push({
      id: "TI16",
      severity: "info",
      path: file.path,
      line: fresh[0] as number,
      detail: `This test file adds ${count} that switch off a linter or type checker, so the checks they silence no longer run on that code.`,
    });
  }
  return signals.sort((a, b) => byCodeUnit(a.path, b.path));
}
