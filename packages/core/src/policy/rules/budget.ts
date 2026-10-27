import type { SettingsModel } from "../settings/model.js";
import { parsePermissionRule, ruleFamily } from "../settings/permissionRule.js";
import type { PolicySetup } from "../types.js";
import { serverTargets } from "./p05.js";

/** Above this many pair units P02, P03 and P05 compare nothing. */
export const COMPARE_BUDGET = 2 ** 26;

const ASCII_TRIM = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

const sumsByFamily = (texts: readonly string[]): Map<string, number> => {
  const sums = new Map<string, number>();
  for (const text of texts) {
    const family = ruleFamily(text);
    sums.set(family, (sums.get(family) ?? 0) + text.length + 1);
  }
  return sums;
};

/** The sum over families of (sum of a's lengths + 1) times (sum of f's lengths + 1): what every same-family pair costs. */
const pairUnits = (a: Map<string, number>, f: Map<string, number>): number => {
  let total = 0;
  for (const [family, sum] of a) total += sum * (f.get(family) ?? 0);
  return total;
};

/**
 * The work P02, P03 and P05 would do, over those of the three that are in force: for each pair they would compare,
 * (length of one + 1) times (length of the other + 1), counting a pair once whichever direction proves it.
 */
export function compareUnits(
  model: SettingsModel,
  setup: PolicySetup | undefined,
  active: { p02: boolean; p03: boolean; p05: boolean },
): number {
  let total = 0;
  if (active.p02) {
    const allow = sumsByFamily(
      model.units.flatMap((unit) =>
        unit.allow
          .filter((entry) => parsePermissionRule(entry.text, "allow").kind !== "inert")
          .map((entry) => entry.text.replace(ASCII_TRIM, "")),
      ),
    );
    total += pairUnits(allow, sumsByFamily(setup?.forbidden_permissions ?? []));
  }
  if (active.p03) {
    const required = sumsByFamily(setup?.required_permissions_deny ?? []);
    for (const unit of model.units) {
      total += pairUnits(sumsByFamily(unit.deny.map((entry) => entry.text)), required);
    }
  }
  if (active.p05) {
    let forbidden = 0;
    for (const entry of setup?.forbidden_mcp_servers ?? []) forbidden += entry.length + 1;
    let targets = 0;
    for (const server of model.mcpServers) for (const target of serverTargets(server)) targets += target.length + 1;
    for (const unit of model.units) for (const entry of unit.enabledMcpjsonServers) targets += entry.text.length + 1;
    total += forbidden * targets;
  }
  return total;
}
