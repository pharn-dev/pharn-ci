// CORE-50 (binary-diff-not-blind). report.v2.json gains five insertions in the known-codes description: the TI01, TI10,
// TI11 and TI14 passages and the TEST_INTEGRITY_INDEX_UNAVAILABLE passage name the file git shows as binary. The pins
// that compare the schema with an older commit take exactly these insertions out first (`withoutCore50SchemaEdits`,
// then `withoutCore69SchemaEdits` and the earlier helpers as before), so every other byte is still pinned. Each
// insertion is ASCII with no character a JSON string escapes, so it can be removed from the raw text and from a parsed
// description alike.

/** Insertion (a): after `or adds a test file of the same name` (TI01). */
export const CORE50_TI01_TEXT =
  "; a deleted or renamed-away JS/TS, Python or Go test file that git shows as binary is error in mode block and warn in mode warn, never info, because its text was not read";

/** Insertion (b): after `or when a pretest or posttest script is removed, and the mode is block, warn in mode warn` (TI10). */
export const CORE50_TI10_TEXT =
  "; a modified or renamed package.json that git shows as binary is judged from its base and head text when both read as JSON, otherwise it is one finding at the same levels";

/** Insertion (c): after `a disabling if: or a near-zero timeout` (TI11). */
export const CORE50_TI11_TEXT =
  "; a workflow file that git shows as binary is one finding, error in mode block and warn in mode warn, because its changes could not be read";

/** Insertion (d): after `lowers the coverage threshold or adds an exclusion and the mode is block, warn in mode warn` (TI14). */
export const CORE50_TI14_TEXT =
  "; a check config that git shows as binary and that the change modifies, renames or deletes is one finding at the same levels, because its changes could not be read";

/** Insertion (e): directly before `; it is not given in mode off` (TEST_INTEGRITY_INDEX_UNAVAILABLE), after the CORE-69 insertion. */
export const CORE50_UNAVAILABLE_TEXT =
  "; a JS/TS or Python test file the change modifies or renames that git shows as binary is named with the reason binary and is an error in mode block whatever the merge base held, as is one whose HEAD text is binary while it was indexed at the merge base, an error the accept label lowers to warn, and an added one that git shows as binary is named with the reason binary as a warn";

/** `text` with `passage` removed; throws unless it appears exactly once. */
function removeOnce(text: string, passage: string, name: string): string {
  const count = text.split(passage).length - 1;
  if (count !== 1) throw new Error(`binary-diff-not-blind: expected the ${name} once, found ${count}`);
  return text.replace(passage, () => "");
}

/** report.v2.json (raw or a parsed description) with the five CORE-50 insertions taken out; throws unless each appears once. */
export function withoutCore50SchemaEdits(text: string): string {
  let out = removeOnce(text, CORE50_TI01_TEXT, "TI01 insertion");
  out = removeOnce(out, CORE50_TI10_TEXT, "TI10 insertion");
  out = removeOnce(out, CORE50_TI11_TEXT, "TI11 insertion");
  out = removeOnce(out, CORE50_TI14_TEXT, "TI14 insertion");
  return removeOnce(out, CORE50_UNAVAILABLE_TEXT, "TEST_INTEGRITY_INDEX_UNAVAILABLE insertion");
}
