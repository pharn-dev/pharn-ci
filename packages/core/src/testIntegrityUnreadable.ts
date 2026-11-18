/**
 * The rule for a test file the change makes unreadable to pharn-ci, kept in one place. Everything here is plain data
 * and pure functions: no imports, no I/O.
 */

/**
 * The reasons a modified test file can fail to index at HEAD that make the per-file
 * `TEST_INTEGRITY_INDEX_UNAVAILABLE` message an error in mode `block`: the change itself can cause each of them while
 * the test runner still runs the file. The one list: a new reason that a change can cause (CORE-50 appends `binary`)
 * is added here and nowhere else. Every other reason (`syntax-error`, `syntax-error-heavy`, `parser-threw`,
 * `missing`, `unsafe-path`, `over-total-cap`, the Python index reasons) stays a warning.
 */
export const HEAD_UNREADABLE_ERROR_REASONS: readonly string[] = ["too-deep", "too-large", "over-file-cap"];

/**
 * Whether a modified test file that is not compared because its head side failed with `headReason` is a change made
 * unreadable: `headReason` is in `HEAD_UNREADABLE_ERROR_REASONS` and the base side either indexed or was dropped as
 * `over-file-cap` (a file that the 200-file cap hid at the merge base was not unreadable by its own content). A file
 * already unreadable at the merge base for another reason is not the change's doing.
 */
export function changeMadeUnreadable(base: { ok: true } | { ok: false; reason: string }, headReason: string): boolean {
  if (!HEAD_UNREADABLE_ERROR_REASONS.includes(headReason)) return false;
  return base.ok || base.reason === "over-file-cap";
}

/** The start of the sentence that says TI02 and TI05 did not run; `report.ts` builds the sentence from it. */
export const TI0205_NOT_RUN_LEAD = "TI02 and TI05 did not run: the text of the touched test files could not be read (";

/** The start of the sentence that says TI09 did not run; `report.ts` builds the sentence from it. */
export const TI09_NOT_RUN_LEAD = "TI09 did not run: the text of the touched test-config files could not be read (";

/**
 * The start of the sentence that says TI02 and TI05 did not run, through the closing parenthesis after `reasonSpan` (the
 * reason as one code span). `report.ts` calls this instead of naming the lead, so that the sentence and the accept
 * label's list of whole-run sentences share one source.
 */
export function ti0205NotRunStart(reasonSpan: string): string {
  return `${TI0205_NOT_RUN_LEAD}${reasonSpan})`;
}

/** The start of the sentence that says TI09 did not run, through the closing parenthesis after `reasonSpan`. */
export function ti09NotRunStart(reasonSpan: string): string {
  return `${TI09_NOT_RUN_LEAD}${reasonSpan})`;
}

/**
 * The starts of the whole-run sentences of the `TEST_INTEGRITY_INDEX_UNAVAILABLE` message. A message that holds one of
 * them is the did-not-run error, which the accept label never lowers.
 */
export const WHOLE_RUN_SENTENCE_LEADS: readonly string[] = [TI0205_NOT_RUN_LEAD, TI09_NOT_RUN_LEAD];
