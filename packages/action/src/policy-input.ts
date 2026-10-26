/** What the `policy` input chose. */
export type PolicyChoice = { kind: "auto" | "never" | "required" } | { kind: "file"; path: string };

const POLICY_INPUT_ERROR = "the policy input must be auto, never, required or file:<path>";

/**
 * Reads the `policy` input: empty or `auto` (fetch the org policy when a token is granted), `never`, `required`
 * (fetching must work) or `file:<path>` (the policy file the pull request carries). The names and the `file:` prefix
 * are case-sensitive. Anything else throws one fixed Error that never repeats the value.
 */
export function parsePolicyInput(value: string): PolicyChoice {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "auto") return { kind: "auto" };
  if (trimmed === "never") return { kind: "never" };
  if (trimmed === "required") return { kind: "required" };
  if (trimmed.startsWith("file:")) return { kind: "file", path: trimmed.slice("file:".length).trim() };
  throw new Error(POLICY_INPUT_ERROR);
}
