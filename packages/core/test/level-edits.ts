// docs-schema-levels: the message-code description of report.v2.json gains two insertions that state the block-mode
// levels #126 shipped for DIFF_UNAVAILABLE and TEST_INTEGRITY_INDEX_UNAVAILABLE. The schema pins that compare
// report.v2.json with an older commit take exactly these two insertions out first, so every other byte stays pinned.

/** Each insertion as [the text at 88ecc5e, the text now]. Neither holds a character that JSON escapes. */
export const SCHEMA_LEVEL_EDITS: readonly (readonly [string, string])[] = [
  [
    "AGENT_SETUP_EXPECTED_MISSING and COVERAGE_LINES_SKIPPED). Codes added in v2",
    "AGENT_SETUP_EXPECTED_MISSING and COVERAGE_LINES_SKIPPED), except DIFF_UNAVAILABLE, which is an error when a coverage threshold is set (0 included) or the test-integrity mode is block, and a warn otherwise. Codes added in v2",
  ],
  [
    "TEST_INTEGRITY_INDEX_UNAVAILABLE (warn: touched",
    "TEST_INTEGRITY_INDEX_UNAVAILABLE (warn, or error in mode block when TI02 and TI05, or TI09, did not run at all: touched",
  ],
];

/** `text` (report.v2.json or its code description) with both insertions taken out; throws unless each appears once. */
export function withoutSchemaLevelEdits(text: string): string {
  let out = text;
  for (const [before, after] of SCHEMA_LEVEL_EDITS) {
    const count = out.split(after).length - 1;
    if (count !== 1) throw new Error(`docs-schema-levels: expected the insertion once, found ${count}: ${after}`);
    out = out.split(after).join(before);
  }
  return out;
}
