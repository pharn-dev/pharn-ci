// CORE-69 (unreadable-test-file-fails-block). report.v2.json gains three insertions in the known-codes description:
// (a) the truncation message can be an error in mode block, (b) python-not-found with a modified Python test file is a
// did-not-run cause, (c) the per-file index message can be an error in mode block. The pins that compare the schema with
// an older commit take exactly these insertions out first (`withoutCore69SchemaEdits`, then the earlier helpers as
// before), so every other byte is still pinned. Each insertion is ASCII with no character a JSON string escapes, so it
// can be removed from the raw text and from a parsed description alike.

/** Insertion (a): after `TEST_INTEGRITY_TEXT_TRUNCATED (warn`. */
export const CORE69_TRUNCATED_TEXT =
  ", or error in mode block when a cut file is a test file the change modifies, an error the accept label lowers to warn";

/** Insertion (b): after `or TI02 and TI05 did not run because the test text could not be read`. */
export const CORE69_PYTHON_TEXT =
  " or no Python interpreter was found while a Python test file is modified (python-not-found)";

/** Insertion (c): directly before `; it is not given in mode off). New codes may be added within v2`. */
export const CORE69_UNREADABLE_TEXT =
  "; in mode block it is also an error when a test file the change modifies cannot be indexed at HEAD for the reason too-deep, too-large or over-file-cap and was indexed at the merge base or dropped there as over-file-cap, an error the accept label lowers to warn";

/** `text` with `passage` removed; throws unless it appears exactly once. */
function removeOnce(text: string, passage: string, name: string): string {
  const count = text.split(passage).length - 1;
  if (count !== 1) throw new Error(`unreadable-test-file-fails-block: expected the ${name} once, found ${count}`);
  return text.replace(passage, () => "");
}

/** report.v2.json (raw or a parsed description) with the three CORE-69 insertions taken out; throws unless each appears once. */
export function withoutCore69SchemaEdits(text: string): string {
  let out = removeOnce(text, CORE69_TRUNCATED_TEXT, "TEXT_TRUNCATED error insertion");
  out = removeOnce(out, CORE69_PYTHON_TEXT, "python-not-found insertion");
  return removeOnce(out, CORE69_UNREADABLE_TEXT, "per-file unreadable insertion");
}
