import { matcherCovers } from "../settings/hooks.js";
import type { SettingsModel } from "../settings/model.js";
import type { PolicyRequiredHook } from "../types.js";
import { shownPattern } from "./shown.js";
import type { RuleFinding } from "./types.js";

/**
 * P06, required hook missing, per settings unit (the root unit always). A requirement is satisfied by a group under the
 * exact event key whose matcher covers the required one and that holds a counting command handler. `disableAllHooks:
 * true` in a unit is one finding in place of that unit's missing-hook findings.
 */
export function detectP06(model: SettingsModel, required: readonly PolicyRequiredHook[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const unit of model.units) {
    const missing: RuleFinding[] = [];
    for (const need of required) {
      const met = unit.hookGroups.some(
        (group) => group.counting && group.event === need.event && matcherCovers(group.matcher, need.matcher),
      );
      if (met) continue;
      const any = need.matcher === undefined || need.matcher === "" || need.matcher === "*";
      missing.push({
        id: "P06",
        fallback: "block",
        path: unit.reportPath,
        line: null,
        detail: `required hook ${shownPattern(need.event)} ${any ? "(any tool)" : shownPattern(need.matcher as string)} is missing`,
      });
    }
    const disabled = unit.disableAllHooks[0];
    if (disabled !== undefined) {
      findings.push({
        id: "P06",
        fallback: "block",
        path: disabled.path,
        line: disabled.line,
        detail: "disableAllHooks turns every hook off",
      });
    } else findings.push(...missing);
  }
  return findings;
}
