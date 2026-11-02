import type { SettingsModelProblem, SettingsReader } from "../settings/model.js";
import type { PolicySettingsProblem } from "../settings/types.js";
import type { PolicySetup } from "../types.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The level of a problem. A file Claude Code would read and pharn-ci did not, or could not parse (too deep, not JSON,
 * not an object, binary), is an error whatever the lists (review A3-F2, settings-unparseable-fails-closed). Deny and
 * hooks problems depend on their required list; the rest warn.
 */
export function settingsProblemLevel(problem: SettingsModelProblem, setup: PolicySetup | undefined): "error" | "warn" {
  const deny = (setup?.required_permissions_deny?.length ?? 0) > 0;
  const hooks = (setup?.required_hooks?.length ?? 0) > 0;
  switch (problem.problemClass) {
    case "drop":
    case "unparseable-settings":
    case "unparseable-mcp":
      return "error";
    case "deny":
      return deny ? "error" : "warn";
    case "hooks":
      return hooks ? "error" : "warn";
    default:
      return "warn";
  }
}

/**
 * The problems a rule in force reads, with their levels, de-duplicated on (path, line, reason) keeping the strongest
 * level, sorted by path (null first), then line (null first, ascending), then reason.
 */
export function reportedProblems(
  problems: readonly SettingsModelProblem[],
  setup: PolicySetup | undefined,
  inForce: ReadonlySet<SettingsReader>,
): PolicySettingsProblem[] {
  const kept = new Map<string, PolicySettingsProblem>();
  for (const problem of problems) {
    if (!problem.readers.some((reader) => inForce.has(reader))) continue;
    const level = settingsProblemLevel(problem, setup);
    const key = `${problem.path ?? "\0"}\u0001${problem.line ?? ""}\u0001${problem.reason}`;
    const known = kept.get(key);
    if (known === undefined) kept.set(key, { path: problem.path, line: problem.line, reason: problem.reason, level });
    else if (level === "error") known.level = "error";
  }
  return [...kept.values()].sort(
    (a, b) =>
      (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : byCodeUnit(a.path, b.path)) ||
      (a.line === b.line ? 0 : a.line === null ? -1 : b.line === null ? 1 : a.line - b.line) ||
      byCodeUnit(a.reason, b.reason),
  );
}
