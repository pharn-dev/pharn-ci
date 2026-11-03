import type { TestBlock } from "../testIndex/types.js";
import { cutCodeUnits, replaceUnsafeChars } from "../text.js";

/** Joins the names of a test and its enclosing blocks. */
const NAME_SEPARATOR = " › ";

/** The longest `detail` of a signal, in UTF-16 code units. */
const MAX_DETAIL = 300;

/**
 * The text with each control, invisible or bidirectional character (see text.ts) turned into a space, one code unit
 * for one, so the length is kept.
 */
function withoutControls(text: string): string {
  return replaceUnsafeChars(text, " ");
}

/** The full name of a test block: the names of its enclosing blocks and its own, outermost first, joined with ` › `. */
export function fullTestName(block: TestBlock): string {
  return block.path.join(NAME_SEPARATOR);
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
  return `${before}${cutCodeUnits(clean, room)}${after}`;
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

/** TI07: a test whose only edit is an expected value, in a change that also edits source. `matcher` is from a fixed list. */
export function expectedValueEditedDetail(name: string, matcher: string): string {
  return detailWithName(
    'The test "',
    name,
    `" changed only an expected value of its ${matcher} assertion, in a change that also edits source files.`,
  );
}

/** The longest test name the tests-changed summary keeps, in UTF-16 code units. */
export const MAX_SUMMARY_NAME = 120;

/** A test name for the tests-changed summary: control characters become spaces; cut to 120 with `…`, never in a pair. */
export function summaryTestName(name: string): string {
  const clean = withoutControls(name);
  return cutCodeUnits(clean, MAX_SUMMARY_NAME);
}

/** TI05: a test that lost some assertions with the rest of its body unchanged. */
export function droppedAssertionsDetail(name: string, baseCount: number, headCount: number): string {
  return detailWithName(
    'The test "',
    name,
    `" had ${baseCount} assertions at base and has ${headCount} at head, with the rest of its body unchanged.`,
  );
}
