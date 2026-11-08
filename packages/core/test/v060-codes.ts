// policy-p13 (Horizon 2 item H1): the message-code description of report.v2.json gains one appended text, the
// "Codes added in v0.6.0" sentence that names POLICY_P13. The schema pins that compare report.v2.json with an older
// commit take exactly this text out first, so every other byte stays pinned. Later v0.6.0 codes extend this text.

/** The text appended to the message-code description (no character in it is escaped by JSON). */
export const V060_CODE_TEXT =
  " Codes added in v0.6.0: POLICY_P13 (error, or the level the org policy sets for P13: an agent pull request widens what an agent may do in an agent settings file, an MCP config, a workflow or CODEOWNERS, changes one of them that could not be read or parsed at the merge base and at HEAD, or could not be checked because the diff is unavailable; the message names up to 20 paths and the evidence as fixed words, and each violation names the kinds of widening as fixed words, never a rule, server, secret, owner or command).";

/** The message codes the v0.6.0 text names. */
export const V060_CODES = ["POLICY_P13"];

/** `text` (report.v2.json or its code description) with the v0.6.0 text taken out; throws unless it appears once. */
export function withoutV060CodeText(text: string): string {
  const count = text.split(V060_CODE_TEXT).length - 1;
  if (count !== 1) throw new Error(`policy-p13: expected the v0.6.0 code text once, found ${count}`);
  return text.replace(V060_CODE_TEXT, "");
}
