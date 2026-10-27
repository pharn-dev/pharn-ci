import type { SettingsModel } from "../settings/model.js";
import {
  overlapsPrepared,
  type PreparedPolicyEntry,
  prepareEntry,
  preparePolicyEntry,
  ruleFamily,
} from "../settings/permissionRule.js";
import { shownPattern } from "./shown.js";
import type { RuleFinding } from "./types.js";

/**
 * P02, forbidden permission allowed. One finding per allow entry that is equal to, broader than or inside a forbidden
 * entry of the policy (C1: either direction the grammar can prove), naming the first such entry as the policy wrote it.
 * A deny entry never excuses an allow entry, and `permissions.ask` is never read. Fixed checks need no policy list:
 * `defaultMode` `bypassPermissions` or `auto` (block, at the value's line) and a non-empty `additionalDirectories`
 * (warn, at the key's line).
 */
export function detectP02(model: SettingsModel, forbidden: readonly string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const byFamily = new Map<string, PreparedPolicyEntry[]>();
  for (const text of forbidden) {
    const family = ruleFamily(text);
    const list = byFamily.get(family);
    const entry = preparePolicyEntry(text);
    if (list === undefined) byFamily.set(family, [entry]);
    else list.push(entry);
  }

  for (const unit of model.units) {
    for (const entry of unit.allow) {
      const candidates = byFamily.get(ruleFamily(entry.text));
      if (candidates === undefined) continue;
      const allow = prepareEntry(entry.text, "allow");
      if (allow.parsed.kind !== "rule") continue;
      const hits: string[] = [];
      for (const candidate of candidates) {
        if (!hits.includes(candidate.text) && overlapsPrepared(allow, candidate)) hits.push(candidate.text);
      }
      if (hits.length === 0) continue;
      const more = hits.length > 1 ? ` and ${hits.length - 1} more` : "";
      findings.push({
        id: "P02",
        fallback: "block",
        path: entry.path,
        line: entry.line,
        detail: `allow rule overlaps forbidden permission ${shownPattern(hits[0] as string)}${more}`,
      });
    }
    for (const mode of unit.defaultModes) {
      if (mode.value === "bypassPermissions") {
        findings.push({
          id: "P02",
          fallback: "block",
          path: mode.path,
          line: mode.line,
          detail: "defaultMode bypassPermissions turns permission prompts off",
        });
      } else if (mode.value === "auto") {
        findings.push({
          id: "P02",
          fallback: "block",
          path: mode.path,
          line: mode.line,
          detail: "defaultMode auto lets a classifier approve actions",
        });
      }
    }
    for (const dirs of unit.additionalDirectories) {
      findings.push({
        id: "P02",
        fallback: "warn",
        path: dirs.path,
        line: dirs.line,
        detail: "additionalDirectories gives the agent file access outside the repository",
      });
    }
  }
  return findings;
}
