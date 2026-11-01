import { compileGlob } from "../../glob.js";
import { shownPattern } from "./shown.js";
import type { PolicyRuleInput, RuleFinding } from "./types.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * P08, forbidden file tracked: a tracked file matches a `setup.forbidden_files` pattern of the policy. One finding per
 * path (the first pattern in list order that matches it), the paths distinct and sorted by code unit. The cap on the
 * number kept is applied after the severity.
 */
export function detectP08(input: PolicyRuleInput): RuleFinding[] {
  const { policy } = input;
  if ((policy.source !== "app" && policy.source !== "file") || policy.document === null) return [];
  const patterns = policy.document.setup?.forbidden_files;
  if (!Array.isArray(patterns) || patterns.length === 0) return [];
  const compiled = patterns.map((pattern) => ({ shown: shownPattern(pattern), matches: compileGlob(pattern) }));
  const findings: RuleFinding[] = [];
  for (const path of [...new Set(input.repoFiles)].sort(byCodeUnit)) {
    const hit = compiled.find((entry) => entry.matches(path));
    if (hit === undefined) continue;
    findings.push({
      id: "P08",
      fallback: "block",
      path,
      line: null,
      detail: `tracked file matches forbidden pattern ${hit.shown}`,
    });
  }
  return findings;
}
