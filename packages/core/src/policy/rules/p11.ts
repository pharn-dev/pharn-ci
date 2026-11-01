import { compileGlob } from "../../glob.js";
import type { PolicyRuleInput, RuleFinding } from "./types.js";

/** The detail of a violation for a changed protected path. Fixed: it never holds a glob, label, login or file text. */
export const P11_PATH_DETAIL = "agent PR changes a protected path";
/** The detail of the one violation a missing diff gives. */
export const P11_DIFF_UNAVAILABLE_DETAIL = "diff unavailable; protected paths could not be checked";
/** The detail of the violation for an edited policy file whose merge-base version could not be read. */
export const P11_BASE_UNREADABLE_DETAIL =
  "policy file edited and unreadable at the merge base; protected paths could not be checked";

/**
 * P11, agent PR changes a protected path. Runs only for an agent PR (a person's pull request is never subject to it)
 * under an app or file policy whose `agents.protected_paths` is non-empty and whose P11 severity is not off. One finding
 * per diff entry whose path, or old path for a rename, matches a protected glob; the finding names the path that
 * matched. A missing diff is one path-less finding (fail closed). An edited policy file that could not be read at the
 * merge base adds one more path-less finding. The severity is already resolved (`agentPolicy.severity`), so a finding's
 * `fallback` is its severity. Nothing here repeats a glob, label or login.
 */
export function detectP11(input: PolicyRuleInput): RuleFinding[] {
  const { policy, agentPolicy, agentPr } = input;
  if ((policy.source !== "app" && policy.source !== "file") || policy.document === null) return [];
  if (agentPolicy === undefined || agentPolicy.severity === null) return [];
  if (agentPolicy.protectedPaths.length === 0) return [];
  if (agentPr?.isAgentPr !== true) return [];
  const severity = agentPolicy.severity;
  const findings: RuleFinding[] = [];
  if (input.diff === null) {
    return [{ id: "P11", fallback: severity, path: null, line: null, detail: P11_DIFF_UNAVAILABLE_DETAIL }];
  }
  const matchers = agentPolicy.protectedPaths.map((glob) => compileGlob(glob));
  const protectedPath = (path: string) => matchers.some((matches) => matches(path));
  for (const entry of input.diff) {
    let path: string | null = null;
    if (protectedPath(entry.path)) path = entry.path;
    else if (entry.oldPath !== entry.path && protectedPath(entry.oldPath)) path = entry.oldPath;
    if (path !== null) findings.push({ id: "P11", fallback: severity, path, line: null, detail: P11_PATH_DETAIL });
  }
  if (agentPolicy.listsIncomplete && agentPolicy.policyFileEdited === true) {
    findings.push({ id: "P11", fallback: severity, path: null, line: null, detail: P11_BASE_UNREADABLE_DETAIL });
  }
  return findings;
}
