import type { SettingsModel } from "../settings/model.js";
import {
  coversPrepared,
  type PreparedEntry,
  type PreparedPolicyEntry,
  prepareEntry,
  preparePolicyEntry,
  ruleFamily,
} from "../settings/permissionRule.js";
import { shownPattern } from "./shown.js";
import type { RuleFinding } from "./types.js";

/**
 * P03, required deny missing, per settings unit (the root unit always). A required entry is satisfied when some deny
 * entry of the unit is equal to or broader than it (not a verbatim match). `supplying` is the paths of the deny entries
 * that satisfy at least one requirement.
 */
export function detectP03(
  model: SettingsModel,
  required: readonly string[],
): { findings: RuleFinding[]; supplying: string[] } {
  const findings: RuleFinding[] = [];
  const supplying = new Set<string>();
  const wanted = required.map((text) => ({ entry: preparePolicyEntry(text), family: ruleFamily(text) }));
  for (const unit of model.units) {
    const byFamily = new Map<string, { entry: PreparedEntry; path: string }[]>();
    for (const deny of unit.deny) {
      const family = ruleFamily(deny.text);
      const list = byFamily.get(family);
      const item = { entry: prepareEntry(deny.text, "deny"), path: deny.path };
      if (list === undefined) byFamily.set(family, [item]);
      else list.push(item);
    }
    for (const need of wanted) {
      const candidates: { entry: PreparedEntry; path: string }[] = byFamily.get(need.family) ?? [];
      let satisfied = false;
      for (const candidate of candidates) {
        if (coversPrepared(candidate.entry, need.entry as PreparedPolicyEntry, "p03")) {
          satisfied = true;
          supplying.add(candidate.path);
        }
      }
      if (!satisfied) {
        findings.push({
          id: "P03",
          fallback: "block",
          path: unit.reportPath,
          line: null,
          detail: `required deny rule ${shownPattern(need.entry.text)} is missing`,
        });
      }
    }
  }
  return { findings, supplying: [...supplying] };
}
