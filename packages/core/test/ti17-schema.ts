// ti17-always-true-matcher-2. TI17 is one more test-integrity signal, so report.v2.json gains one id (the signal id
// pattern accepts TI17) and one passage in the known-codes description, and policy.v1.json gains a TI17 severity key and
// two edited descriptions. The pins that compare a schema with an older commit take exactly these edits out first
// (`withoutTi17SchemaEdits` or `withoutTi17PolicySchemaEdits`, then the earlier helpers as before), so every other byte
// is still pinned.

/** The signal id pattern before TI17. */
export const TI17_OLD_PATTERN = '"pattern": "^TI(0[1-9]|1[0-6])$"';
/** The signal id pattern that accepts TI17. */
export const TI17_NEW_PATTERN = '"pattern": "^TI(0[1-9]|1[0-7])$"';

/** The passage report.v2.json gains in the message-code description, directly after the TI16 parenthetical. */
export const TI17_CODE_TEXT =
  ", TEST_INTEGRITY_TI17 (TI17, an assertion that always passes added to a JS/TS or Python test file: a custom matcher whose pass is always true, a helper that always returns True, or a wildcard in place of an expected value; warn in modes block and warn, never block unless an org policy sets it; one finding per test file, in testIntegrity.signals)";

/** The `TI17` member of the policy schema's `test_integrity.signals.properties`, with the comma before it. */
export const TI17_POLICY_KEY_TEXT = `,
            "TI17": {
              "description": "Severity of signal TI17. Tighten: block > warn > info > off.",
              "$ref": "#/$defs/severity"
            }`;

export const TI17_POLICY_SECTION_NEW = '"Test-integrity signal settings (TI01-TI17)."';
export const TI17_POLICY_SECTION_OLD = '"Test-integrity signal settings (TI01-TI16)."';
export const TI17_POLICY_SIGNALS_NEW = "keyed by signal id TI01-TI17; any other key (TI18 included) is an error;";
export const TI17_POLICY_SIGNALS_OLD = "keyed by signal id TI01-TI16; any other key (TI17 included) is an error;";

/** `text` with `from` replaced by `to`; throws unless `from` appears exactly once. */
function replaceOnce(text: string, from: string, to: string, name: string): string {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`ti17-always-true-matcher-2: expected the ${name} once, found ${count}`);
  return text.replace(from, () => to);
}

/** report.v2.json with the TI17 edits taken out (the id pattern and the code passage); throws unless each appears once. */
export function withoutTi17SchemaEdits(text: string): string {
  const out = replaceOnce(text, TI17_CODE_TEXT, "", "TEST_INTEGRITY_TI17 passage");
  return replaceOnce(out, TI17_NEW_PATTERN, TI17_OLD_PATTERN, "TI17 signal id pattern");
}

/** policy.v1.json with the TI17 edits taken out (the TI17 key and the two range descriptions); throws unless each appears once. */
export function withoutTi17PolicySchemaEdits(text: string): string {
  let out = replaceOnce(text, TI17_POLICY_KEY_TEXT, "", "TI17 policy key");
  out = replaceOnce(out, TI17_POLICY_SECTION_NEW, TI17_POLICY_SECTION_OLD, "test_integrity description");
  return replaceOnce(out, TI17_POLICY_SIGNALS_NEW, TI17_POLICY_SIGNALS_OLD, "signals description");
}
