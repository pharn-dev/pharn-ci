/**
 * The rule for a test file the change makes unreadable to pharn-ci, kept in one place. Everything here is plain data
 * and pure functions: no imports, no I/O.
 */

/**
 * The reasons a modified test file can fail to index at HEAD that make the per-file
 * `TEST_INTEGRITY_INDEX_UNAVAILABLE` message an error in mode `block`: the change itself can cause each of them while
 * the test runner still runs the file. The one list: a new reason that a change can cause is added here and nowhere
 * else. `binary` (CORE-50) is the sources' drop of a head text that holds a NUL byte or is not UTF-8. A head that
 * fails for another reason stays a warning under this rule alone (`syntax-error`, `syntax-error-heavy`, `missing`, a
 * JS or TS `parser-threw`, `unsafe-path`, `over-total-cap`); the rules below (`sourcesDropFailsClosed` and
 * `pythonHeadFailsClosed`) make some of them an error too.
 */
export const HEAD_UNREADABLE_ERROR_REASONS: readonly string[] = ["too-deep", "too-large", "over-file-cap", "binary"];

/**
 * The reason of a modified or renamed test file whose diff entry git shows as binary (CORE-50): a `-diff` or `binary`
 * attribute in `.gitattributes`, or non-text content. Such an entry carries `changeMadeUnreadable` with no condition on
 * the merge base (the signals that read diff text cannot read its change, whether or not its base and head text could
 * be indexed), while the sources' own `binary` drop at HEAD follows `changeMadeUnreadable(base, headReason)` like the
 * other listed reasons.
 */
export const BINARY_DIFF_REASON = "binary";

/** Whether an entry of the index-unavailable lists has the reason `binary` (a diff entry or a sources drop). */
export function hasBinaryReason(entry: { reason: string }): boolean {
  return entry.reason === BINARY_DIFF_REASON;
}

/**
 * Whether a touched-file entry is a binary change made unreadable: the reason `binary` with `changeMadeUnreadable`. The
 * `TEST_INTEGRITY_INDEX_UNAVAILABLE` text names these in a sentence of their own; a `binary` entry without the flag
 * (the merge-base side was dropped) stays in the TI02 and TI05 sentence.
 */
export function isBinaryUnreadable(entry: { reason: string; changeMadeUnreadable?: boolean }): boolean {
  return hasBinaryReason(entry) && entry.changeMadeUnreadable === true;
}

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

/**
 * How one side (merge base or HEAD) of a touched test file came out: it indexed, or it failed with `reason`.
 * `hadText` says the sources held the side's text (so the failure is a refusal of the parser or of the Python index,
 * never a drop of the sources); `fromPythonIndex` says the failure came from a Python index the caller passed (a
 * run-level reason or a per-file refusal), never set when the caller passed none.
 */
export type SideOutcome = { ok: true } | { ok: false; reason: string; hadText: boolean; fromPythonIndex: boolean };

/**
 * The reasons for which a side the sources dropped makes a compared file fail closed whatever the other side holds: a
 * file count or total byte cap is a budget the pull request can spend (by adding files or padding other files), so the
 * drop says nothing about the file itself.
 */
export const DROP_ALWAYS_FAILS_CLOSED_REASONS: readonly string[] = ["over-file-cap", "over-total-cap"];

/**
 * The reasons for which a side the sources dropped makes a compared file fail closed when the other side's text was
 * held: the file crossed a boundary (size, encoding, path safety) between the merge base and HEAD, or the reverse, and
 * the pull request moved it across.
 */
export const DROP_FAILS_CLOSED_AGAINST_TEXT_REASONS: readonly string[] = ["too-large", "binary", "unsafe-path"];

/**
 * Whether a compared file fails closed because the sources dropped a side, whatever the language: a side dropped
 * (`hadText` false) as `over-file-cap` or `over-total-cap` fails closed whatever the other side holds; a side dropped as
 * `too-large`, `binary` or `unsafe-path` fails closed when the other side's text was held (it indexed, or its text was
 * refused). Not a case: `too-large` or `binary` on both sides (the file was already out of reach at the merge base),
 * `missing` on either side (the file is not in the tree), and a side that failed with its text held.
 */
export function sourcesDropFailsClosed(base: SideOutcome, head: SideOutcome): boolean {
  const dropFails = (side: SideOutcome, other: SideOutcome): boolean => {
    if (side.ok || side.hadText) return false;
    if (DROP_ALWAYS_FAILS_CLOSED_REASONS.includes(side.reason)) return true;
    return DROP_FAILS_CLOSED_AGAINST_TEXT_REASONS.includes(side.reason) && (other.ok || other.hadText);
  };
  return dropFails(base, head) || dropFails(head, base);
}

/** The per-file refusals of the Python index that `pythonHeadFailsClosed` counts, beside the run-level reasons. */
export const PYTHON_FILE_REFUSAL_REASONS: readonly string[] = ["syntax-error", "too-deep", "too-large", "parser-threw"];

/**
 * Whether a `.py` test file fails closed because its head side, whose text the sources held, was not read by the Python
 * index: a run-level reason (any of `PYTHON_INDEX_UNAVAILABLE_REASONS`, `python-not-found` included) or a per-file
 * refusal (`syntax-error`, `too-deep`, `too-large`, `parser-threw`). It reads the head side only, so a base the index
 * read and a base it refused give the same answer. Not a case: a head that indexed with a base only the index refused,
 * the index's own `missing` (a path absent from a run that ran), and a caller that passed no Python index.
 */
export function pythonHeadFailsClosed(head: SideOutcome): boolean {
  return !head.ok && head.hadText && head.fromPythonIndex;
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
