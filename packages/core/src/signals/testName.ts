import type { TestBlock } from "../testIndex/types.js";

/** Joins the names of a test and its enclosing blocks. */
const NAME_SEPARATOR = " › ";

/** The longest `detail` of a signal, in UTF-16 code units. */
const MAX_DETAIL = 300;

/** Control characters (U+0000 to U+001F, U+007F to U+009F) and the line and paragraph separators (U+2028, U+2029). */
function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** The text with each control character turned into a space. */
function withoutControls(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += isControl(text.charCodeAt(i)) ? " " : (text[i] as string);
  return out;
}

/** The full name of a test block: the names of its enclosing blocks and its own, outermost first, joined with ` › `. */
export function fullTestName(block: TestBlock): string {
  return block.path.join(NAME_SEPARATOR);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * A finding detail made of fixed text around a test name taken from the pull request. Control characters in the name
 * become spaces. A name that does not fit is cut, never inside a surrogate pair, with `…` appended, so the whole detail
 * is at most 300 code units.
 */
export function detailWithName(before: string, name: string, after: string): string {
  const clean = withoutControls(name);
  const room = MAX_DETAIL - before.length - after.length;
  if (clean.length <= room) return `${before}${clean}${after}`;
  let end = Math.max(0, room - 1);
  if (end > 0 && isHighSurrogate(clean.charCodeAt(end - 1))) end--;
  return `${before}${clean.slice(0, end)}…${after}`;
}

/** TI02: a test of a static name that is gone at head. `line` is the line in the base file. */
export function removedTestDetail(name: string, line: number): string {
  return detailWithName(
    'The test "',
    name,
    `" at line ${line} of the base is gone at head, and no test with the same name or a similar body takes its place.`,
  );
}

/** TI02: a test whose name is computed that is gone at head. `line` is the line in the base file. */
export function removedDynamicTestDetail(name: string, line: number): string {
  return detailWithName(
    'The test "',
    name,
    `", whose name is computed, at line ${line} of the base is gone at head, and no test with a similar body takes its place.`,
  );
}

/** TI05: a test that had assertions at base and has none at head, and calls no assertion helper. */
export function emptiedTestDetail(name: string, baseCount: number): string {
  return detailWithName(
    'The test "',
    name,
    `" had ${baseCount} assertions at base and has none at head, and it calls no assertion helper.`,
  );
}

/** TI05: a test that had assertions at base and has none at head, and calls a function that looks like a helper. */
export function helperTestDetail(name: string, baseCount: number): string {
  return detailWithName(
    'The test "',
    name,
    `" had ${baseCount} assertions at base and has none at head; it calls a function whose name suggests an assertion helper.`,
  );
}

/** TI05: a test that lost some assertions with the rest of its body unchanged. */
export function droppedAssertionsDetail(name: string, baseCount: number, headCount: number): string {
  return detailWithName(
    'The test "',
    name,
    `" had ${baseCount} assertions at base and has ${headCount} at head, with the rest of its body unchanged.`,
  );
}
