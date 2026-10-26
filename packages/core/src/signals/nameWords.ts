import type { TestBlock } from "../testIndex/types.js";

/** A word of a test name: a maximal run of letters and digits. */
const WORD = /[\p{L}\p{N}]+/gu;

/** The distinct lowercased words of `text`: the runs of letters and digits. */
export function nameWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(WORD) ?? []) as string[]);
}

/** The words of the test's own name (the last entry of its path). */
export function leafNameWords(block: TestBlock): Set<string> {
  return nameWords(block.path[block.path.length - 1] ?? "");
}

/** The words of the names of the test and all its enclosing blocks. */
export function fullNameWords(block: TestBlock): Set<string> {
  return nameWords(block.path.join(" "));
}

/** A key of the exact names of the enclosing blocks: two tests share it only when their groups have the same names. */
export function groupKey(block: TestBlock): string {
  return JSON.stringify(block.path.slice(0, -1));
}
