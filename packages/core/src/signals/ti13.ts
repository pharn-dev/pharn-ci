import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { byCodeUnit } from "../text.js";
import { coverageSourceLanguage } from "./signalFiles.js";

/** The most TI13 signals one file gives; the rest are dropped, keeping the lowest line numbers. */
const MAX_PER_FILE = 20;

type Family = "istanbul" | "v8" | "c8" | "pragma";

/** One fixed sentence per family. No comment text from the diff reaches a detail. */
const DETAILS: Readonly<Record<Family, string>> = {
  istanbul: "An Istanbul coverage hint was added, so the code it marks leaves the coverage this check grades.",
  v8: "A V8 coverage hint was added, so the code it marks leaves the coverage this check grades.",
  c8: "A C8 coverage hint was added, so the code it marks leaves the coverage this check grades.",
  pragma:
    "A coverage.py exclusion pragma was added, so the Python code it marks leaves the coverage this check grades.",
};

// The patterns are built from parts, so that this file holds no comment that the check would read as a marker.
const BLOCK_OR_LINE_START = String.raw`(?:\/\*|\/\/)`;
const SPACES = String.raw`[ \t]*`;
const WORD_END = "(?![A-Za-z0-9_])";

/** A JavaScript or TypeScript marker: a comment start, the tool word, spaces and the word that ends the hint. */
const JS_MARKER = new RegExp(`${BLOCK_OR_LINE_START}${SPACES}(istanbul|v8|c8)[ \\t]+ignore${WORD_END}`, "i");

/**
 * A Python marker, as coverage.py's default exclusion reads it: a hash, optional spaces, the word pragma, an optional
 * colon, optional spaces, `no`, optional spaces, `cover` (`# pragma: no cover`, `#pragma nocover`).
 */
const PY_MARKER = new RegExp(`#${SPACES}pragma:?${SPACES}no${SPACES}cover${WORD_END}`, "i");

/** The index of the first character at or after `from` that is not a space or a tab. */
function skipBlanks(text: string, from: number): number {
  let i = from;
  while (text[i] === " " || text[i] === "\t") i++;
  return i;
}

/**
 * Whether a JavaScript hint marks one line or one branch: `next` without a count, `if` or `else`. A whole-file hint
 * (`file`), a range (`start`, `stop`, `next` with a count) and a hint whose reach is not one of these words are not.
 * Read from where the marker match ends, one character at a time (no backtracking pattern).
 */
function lineLevelJs(text: string, end: number): boolean {
  const start = skipBlanks(text, end);
  if (start === end) return false;
  let stop = start;
  while (stop < text.length && /[A-Za-z]/.test(text[stop] as string)) stop++;
  if (stop === start || /[0-9_]/.test(text[stop] ?? "")) return false;
  const word = text.slice(start, stop).toLowerCase();
  if (word === "next") {
    const after = skipBlanks(text, stop);
    return !(after > stop && /[0-9]/.test(text[after] ?? ""));
  }
  return word === "if" || word === "else";
}

/**
 * The marker a line carries for the file's language, as its family, its normalized text and whether it marks one line
 * (every Python pragma does: coverage.py has no whole-file form), else null.
 */
function markerOf(
  text: string,
  language: "jsts" | "python",
): { family: Family; marker: string; lineLevel: boolean } | null {
  const match = (language === "jsts" ? JS_MARKER : PY_MARKER).exec(text);
  if (match === null) return null;
  // Python spellings that coverage.py reads alike (`no cover`, `nocover`, with or without the colon) are one marker.
  const marker =
    language === "python"
      ? match[0].toLowerCase().replace(/[ \t:]+/g, "")
      : match[0].toLowerCase().replace(/[ \t]+/g, " ");
  const family = language === "python" ? "pragma" : ((match[1] as string).toLowerCase() as Family);
  const lineLevel = language === "python" || lineLevelJs(text, match.index + match[0].length);
  return { family, marker, lineLevel };
}

/**
 * TI13, a coverage-ignore comment added to source. In a JavaScript, TypeScript or Python file that is not a test file
 * (an added file counts), an added line that carries the Istanbul, V8 or C8 ignore hint in a comment, or the Python
 * no-cover pragma, is one signal at its line in the new file, with the mode as its severity. In a file the change adds,
 * a marker that reaches one line or one branch (the Python pragma, a JavaScript hint whose reach is `next` without a
 * count, `if` or `else`) is `warn` instead; a whole-file or range hint there keeps the mode. A marker is matched by its
 * normalized text (lower case, white space collapsed): a removed line of the same file with the same marker accounts
 * for one added marker (an edit or a move), and each removed marker is used once, in line order. At most 20 signals per
 * file, on the lowest line numbers. No comment text reaches a signal: every detail is one fixed sentence.
 */
export function detectTI13(diff: readonly DiffFile[], mode: "block" | "warn"): TestIntegritySignal[] {
  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || isTestFile(file.path)) continue;
    const language = coverageSourceLanguage(file.path);
    if (language === null) continue;

    const removed = new Map<string, number>();
    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) {
        const found = markerOf(entry.text, language);
        if (found !== null) removed.set(found.marker, (removed.get(found.marker) ?? 0) + 1);
      }
    }

    const added: Array<{ line: number; family: Family; marker: string; lineLevel: boolean }> = [];
    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        const found = markerOf(entry.text, language);
        if (found !== null) added.push({ line: entry.line, ...found });
      }
    }
    added.sort((a, b) => a.line - b.line);

    const fresh: Array<{ line: number; family: Family; lineLevel: boolean }> = [];
    for (const entry of added) {
      const left = removed.get(entry.marker) ?? 0;
      if (left > 0) removed.set(entry.marker, left - 1);
      else fresh.push(entry);
    }
    // A hint on one line of a file the change adds marks code that never had coverage to lose: warn, not block.
    const newFile = file.status === "added";
    for (const { line, family, lineLevel } of fresh.slice(0, MAX_PER_FILE)) {
      const severity = newFile && lineLevel ? "warn" : mode;
      signals.push({ id: "TI13", severity, path: file.path, line, detail: DETAILS[family] });
    }
  }
  return signals.sort(
    (a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.detail, b.detail),
  );
}
