// CORE-125 (R5.8, epic CORE-10): the policy schema's descriptions say what the code applies. `policy.required` no
// longer claims to make an unavailable policy block (only the `policy: required` input does), and
// `agents.require_human_approval` and P12 say they are validated and not applied; agent-PR detection feeds P11, P13 and
// P14. Descriptions only: no key, type or pattern changed. The pins that compare policy.v1.json with an older commit put
// exactly these descriptions back first (`withoutCore125PolicySchemaEdits`), so every other byte is still pinned. Each
// text is ASCII with no character a JSON string escapes, so it can be swapped in the raw text.

/** Each edit as [the description before CORE-125, the description now], each a whole JSON string with its quotes. */
export const CORE125_POLICY_SCHEMA_EDITS: readonly (readonly [string, string])[] = [
  [
    '"Whether an unavailable policy blocks the check; feeds P10. Tighten: booleans, true wins."',
    '"In an app policy, true makes agent settings files that could not be read (so P02 to P06 did not run) a POLICY_SETTINGS_INVALID error instead of a warning. It does not make a policy that could not be fetched block the check: a policy that is not there cannot ask for that, and only the workflow input `policy: required` turns a fetch failure into a failing POLICY_UNAVAILABLE (P10). Not allowed in a `file:` policy (named in POLICY_OVERRIDE_IGNORED). Tighten: booleans, true wins."',
  ],
  [
    '"Severity of rule P12. Tighten: block > warn > info > off."',
    '"Severity of rule P12 (agent pull request needs a human approval). Validated and not applied: this release runs no P12, so the value changes nothing. Tighten: block > warn > info > off."',
  ],
  [
    '"Agent pull request detection and rules (P11, P12, P14)."',
    '"Agent pull request detection and rules (P11, P13 and P14; P12 is validated and not applied)."',
  ],
  [
    '"Pull request LABELs that mark an agent pull request; feeds agent PR detection for P11, P12 and P14. Tighten: union."',
    '"Pull request LABELs that mark an agent pull request; feeds agent PR detection for P11, P13 and P14. Tighten: union."',
  ],
  [
    '"Extra GitHub LOGINs whose pull requests are agent pull requests; feeds agent PR detection for P11, P12 and P14. Tighten: union."',
    '"Extra GitHub LOGINs whose pull requests are agent pull requests; feeds agent PR detection for P11, P13 and P14. Tighten: union."',
  ],
  [
    '"Whether an agent pull request needs a human approval; feeds P12. Tighten: true wins."',
    '"Whether an agent pull request needs a human approval; meant for P12. Validated and not applied: this release runs no P12 and checks no approval, so the value changes nothing. Tighten: true wins."',
  ],
];

/** `text` (policy.v1.json) with each CORE-125 description put back; throws unless each appears exactly once. */
export function withoutCore125PolicySchemaEdits(text: string): string {
  let out = text;
  for (const [before, after] of CORE125_POLICY_SCHEMA_EDITS) {
    const count = out.split(after).length - 1;
    if (count !== 1) throw new Error(`core125-policy-schema-text: expected the edit once, found ${count}: ${after}`);
    out = out.replace(after, () => before);
  }
  return out;
}
