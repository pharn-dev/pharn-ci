// CORE-95 (config read at the merge base) rewords the one TI14 message sentence on purpose: a change that edits the
// config is checked with the config at the merge base, so TI14 now tells the reviewer that the looser setting applies
// to every later pull request once merged. The regression tests that pin the earlier signals and messages by a digest
// put the earlier sentence back before they hash, so their digests still pin every other byte.

/** The TI14 message's closing sentence since CORE-95. */
export const CORE95_TI14_NOW =
  "Once merged, the looser setting applies to every later pull request; check that it was meant.";

/** The TI14 message's closing sentence before CORE-95. */
export const CORE95_TI14_BEFORE = "Check that the looser setting was meant before trusting the result.";

/** `text` with the TI14 sentence as it was before CORE-95. */
export const withCore95Ti14Before = (text: string): string => text.split(CORE95_TI14_NOW).join(CORE95_TI14_BEFORE);
