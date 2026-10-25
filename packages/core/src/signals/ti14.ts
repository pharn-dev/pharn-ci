import { parseExcludePattern } from "../config.js";
import type { DiffFile, DiffLineText } from "../diff/unified.js";
import { configRepoPath } from "../gateInputs.js";
import type { TestIntegritySignal } from "../report.js";
import { flowItems, indentOf, keyValue, listItem } from "./yamlLines.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface TI14Options {
  /** The `configPath` the check was given; absent means `.pharn/ci.yml`. */
  configPath?: string | undefined;
  repoRoot?: string | undefined;
  /** The exclusion patterns the check was given, from every source. */
  exclude: readonly string[];
  /** The effective mode; the block rules take it as their severity. */
  mode: "block" | "warn";
}

/** A threshold written as a plain number a config could hold (0 to 100 with a few decimals). */
const PLAIN_NUMBER = /^\d{1,3}(?:\.\d{1,4})?$/;

/** A pattern in the form the exclusion list compares it in: normalized when valid, as written otherwise. */
function normalizedPattern(item: string): string {
  try {
    return parseExcludePattern(item);
  } catch {
    return item;
  }
}

/** The plain number of a `threshold:` line, "" when the line is another key or its value is not a plain number. */
function thresholdOf(text: string): string | null {
  const kv = keyValue(text);
  if (kv === null || kv.key !== "threshold") return null;
  return PLAIN_NUMBER.test(kv.value) ? kv.value : "";
}

interface Candidate {
  value: string;
  line: number;
}

/** The exclusion patterns the added lines of this file introduce, in file order. */
function addedExclusions(hunks: ReadonlyArray<{ added: DiffLineText[] }>, known: ReadonlySet<string>): Candidate[] {
  const found: Candidate[] = [];
  for (const hunk of hunks) {
    let owner: { indent: number } | null = null;
    let previous = -1;
    for (const entry of hunk.added) {
      const consecutive = entry.line === previous + 1;
      previous = entry.line;
      const kv = keyValue(entry.text);
      const item = kv === null ? listItem(entry.text) : null;
      if (kv !== null) {
        owner = null;
        if (kv.key !== "exclude") continue;
        const flow = flowItems(kv.value);
        if (flow !== null) for (const value of flow) found.push({ value, line: entry.line });
        else if (kv.value === "") owner = { indent: kv.indent };
      } else if (item !== null) {
        if (owner !== null && consecutive && indentOf(entry.text) >= owner.indent) {
          found.push({ value: item, line: entry.line });
        } else if (known.has(normalizedPattern(item))) {
          // A bare list item cannot be tied to its key without context lines; the patterns the check was given say
          // which items are exclusions.
          found.push({ value: item, line: entry.line });
          owner = null;
        }
      } else {
        owner = null;
      }
    }
  }
  return found;
}

/** The exclusion-shaped values the removed lines of this file held: list items and `exclude: [..]` items. */
function removedValues(hunks: ReadonlyArray<{ removed: DiffLineText[] }>): Set<string> {
  const values = new Set<string>();
  for (const hunk of hunks) {
    for (const entry of hunk.removed) {
      const kv = keyValue(entry.text);
      if (kv !== null) {
        const flow = kv.key === "exclude" ? flowItems(kv.value) : null;
        if (flow !== null) for (const value of flow) values.add(normalizedPattern(value));
        continue;
      }
      const item = listItem(entry.text);
      if (item !== null) values.add(normalizedPattern(item));
    }
  }
  return values;
}

/**
 * TI14, the diff-coverage exclusions widened or the threshold lowered in the pharn-ci config in use. It reads only the
 * added and removed lines of that file. A `threshold:` line removed with a smaller one added, or removed with none
 * added (a deleted or renamed-away config included), is one finding; an exclusion pattern the base did not have (an
 * `exclude: [..]` flow list, block items after an added `exclude:` key, or an added list item that is one of the
 * patterns the check was given) is another. Both take the effective mode as their severity. One signal per rule, on its
 * first matching line; the detail is a fixed sentence plus, for the threshold, the two numbers.
 */
export function detectTI14(diff: readonly DiffFile[], options: TI14Options): TestIntegritySignal[] {
  const config = configRepoPath(options.configPath, options.repoRoot);
  if (config === null) return [];
  const known = new Set(options.exclude.map(normalizedPattern));
  const signals: TestIntegritySignal[] = [];

  for (const file of diff) {
    if (file.path !== config && file.oldPath !== config) continue;
    if (file.hunks === undefined || file.binary === true) continue;
    const path = file.path === config ? file.path : file.oldPath;

    const removedNumbers: Array<{ value: string; line: number }> = [];
    const addedNumbers: Array<{ value: string; line: number }> = [];
    let addedThresholdLine = false;
    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) {
        const value = thresholdOf(entry.text);
        if (value !== null && value !== "") removedNumbers.push({ value, line: entry.line });
      }
      for (const entry of hunk.added) {
        const value = thresholdOf(entry.text);
        if (value === null) continue;
        addedThresholdLine = true;
        if (value !== "") addedNumbers.push({ value, line: entry.line });
      }
    }
    const before = removedNumbers[removedNumbers.length - 1];
    const after = addedNumbers[addedNumbers.length - 1];
    if (before !== undefined && after !== undefined && Number(after.value) < Number(before.value)) {
      signals.push({
        id: "TI14",
        severity: options.mode,
        path,
        line: after.line,
        detail: `Coverage threshold lowered from ${before.value} to ${after.value}.`,
      });
    } else if (before !== undefined && !addedThresholdLine) {
      signals.push({
        id: "TI14",
        severity: options.mode,
        path,
        line: before.line,
        detail: `Coverage threshold removed (it was ${before.value}).`,
      });
    }

    const removed = removedValues(file.hunks);
    const fresh = addedExclusions(file.hunks, known).find(
      (candidate) => !removed.has(normalizedPattern(candidate.value)),
    );
    if (fresh !== undefined) {
      signals.push({
        id: "TI14",
        severity: options.mode,
        path,
        line: fresh.line,
        detail: "A coverage exclusion was added to the check config, so changed files it matches leave diff coverage.",
      });
    }
  }
  return signals.sort((a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0));
}
