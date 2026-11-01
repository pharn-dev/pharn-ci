import { readSettingsModel, type SettingsReader } from "../settings/model.js";
import type { PolicySettingsOutcome } from "../settings/types.js";
import type { PolicyRuleId } from "../types.js";
import { COMPARE_BUDGET, compareUnits } from "./budget.js";
import { detectP01 } from "./p01.js";
import { detectP02 } from "./p02.js";
import { detectP03 } from "./p03.js";
import { detectP04 } from "./p04.js";
import { detectP05 } from "./p05.js";
import { detectP06 } from "./p06.js";
import { consistencySeverity, detectP07 } from "./p07.js";
import { detectP08 } from "./p08.js";
import { detectP09, type SettingsView } from "./p09.js";
import { detectP10 } from "./p10.js";
import { detectP11 } from "./p11.js";
import { reportedProblems } from "./problems.js";
import { boundDetail, resolveSeverity, strongest } from "./severity.js";
import type { PolicyEvaluation, PolicyRuleInput, PolicyViolation, RuleFinding } from "./types.js";

/** The most violations of one rule id the report keeps; the rest are counted. */
export const MAX_RULE_VIOLATIONS = 50;
/** The P07 cap, the same value as `MAX_RULE_VIOLATIONS`. */
export const MAX_P07_VIOLATIONS = 50;
/** The P08 cap, which item 22 named first; the same value as `MAX_RULE_VIOLATIONS`. */
export const MAX_P08_VIOLATIONS = 50;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const SETTINGS_READERS = ["P02", "P03", "P04", "P05", "P06"] as const satisfies readonly SettingsReader[];
const SETTINGS_RULES: readonly string[] = SETTINGS_READERS;

/**
 * Run the org-policy rules (P01 to P11) over what the check already has, apply the policy's rule severities, sort,
 * and cap every rule id at 50. Pure and deterministic; the input is never mutated.
 */
export function evaluatePolicyRules(input: PolicyRuleInput): PolicyEvaluation {
  const { policy } = input;
  const document = policy.document;
  const inForce = (policy.source === "app" || policy.source === "file") && document !== null;
  // P07 is evaluated only when the caller gave the instruction files; only then are its looser file values recorded.
  const consistency =
    input.agentInstructions === null || input.agentInstructions === undefined
      ? null
      : consistencySeverity(input.policy);
  const lowered = new Set<PolicyRuleId>();
  if (input.agentPolicy?.lowered === true) lowered.add("P11");
  if (consistency?.lowered === true) lowered.add("P07");

  const resolve = (findings: readonly RuleFinding[]): PolicyViolation[] => {
    const out: PolicyViolation[] = [];
    for (const finding of findings) {
      // P10 is fixed, and the severities of P07 (`consistencySeverity`) and P11 (`agentPolicy.severity`) are already
      // resolved: the finding carries them.
      if (finding.id === "P10" || finding.id === "P07" || finding.id === "P11") {
        out.push({
          id: finding.id,
          severity: finding.fallback,
          path: finding.path,
          line: finding.line,
          detail: boundDetail(finding.detail),
        });
        continue;
      }
      const resolved = resolveSeverity(policy, finding.id, finding.fallback);
      if (resolved.lowered) lowered.add(finding.id);
      if (resolved.severity === null) continue;
      out.push({
        id: finding.id,
        severity: resolved.severity,
        path: finding.path,
        line: finding.line,
        detail: boundDetail(finding.detail),
      });
    }
    return out;
  };

  const settingsFindings: RuleFinding[] = [];
  let settings: PolicySettingsOutcome | undefined;
  let view: SettingsView | null = null;
  const supplying = new Set<string>();
  const sources = input.settingsSources;

  if (inForce && sources !== undefined) {
    if ("unavailable" in sources) {
      const required = policy.source === "app" && document.policy?.required === true;
      settings = { unavailable: { reason: sources.unavailable, level: required ? "error" : "warn" }, problems: [] };
    } else {
      const setup = document.setup;
      const on = (id: PolicyRuleId, listed: boolean) =>
        listed && resolveSeverity(policy, id, "block").severity !== null;
      const active = {
        P02: on("P02", true),
        P03: on("P03", (setup?.required_permissions_deny?.length ?? 0) > 0),
        P04: on("P04", (setup?.allowed_mcp_servers?.length ?? 0) > 0),
        P05: on("P05", (setup?.forbidden_mcp_servers?.length ?? 0) > 0),
        P06: on("P06", (setup?.required_hooks?.length ?? 0) > 0),
      };
      const model = readSettingsModel(sources, document);
      const over = compareUnits(model, setup, { p02: active.P02, p03: active.P03, p05: active.P05 }) > COMPARE_BUDGET;
      if (active.P02 && !over) settingsFindings.push(...detectP02(model, setup?.forbidden_permissions ?? []));
      if (active.P03 && !over) {
        const p03 = detectP03(model, setup?.required_permissions_deny ?? []);
        settingsFindings.push(...p03.findings);
        for (const path of p03.supplying) supplying.add(path);
      }
      if (active.P04) settingsFindings.push(...detectP04(model, setup?.allowed_mcp_servers ?? []));
      if (active.P05 && !over) settingsFindings.push(...detectP05(model, setup?.forbidden_mcp_servers ?? []));
      if (active.P06) {
        const p06 = detectP06(model, setup?.required_hooks ?? []);
        settingsFindings.push(...p06.findings);
        for (const path of p06.supplying) supplying.add(path);
      }
      const readers = new Set<SettingsReader>(SETTINGS_READERS.filter((id) => active[id]));
      const problems = reportedProblems(model.problems, setup, readers);
      if (over) problems.unshift({ path: null, line: null, reason: "compare-budget", level: "error" });
      settings = { unavailable: null, problems };
      const uncheckable = new Set<string>();
      for (const problem of problems)
        if (problem.path !== null && problem.level === "error") uncheckable.add(problem.path);
      view = { failing: new Map(), uncheckable, supplying };
    }
  }

  const first = resolve([
    ...detectP01(input),
    ...detectP08(input),
    ...settingsFindings,
    ...detectP07(input, consistency?.severity ?? null),
    ...detectP10(input),
    ...detectP11(input),
  ]);
  if (view !== null) {
    for (const violation of first) {
      if (!SETTINGS_RULES.includes(violation.id) || violation.path === null) continue;
      const known = view.failing.get(violation.path);
      if (known === undefined) view.failing.set(violation.path, { ids: [violation.id], severity: violation.severity });
      else {
        known.ids.push(violation.id);
        known.severity = strongest([known.severity, violation.severity]);
      }
    }
  }
  let violations = [...first, ...resolve(detectP09(input, view))];

  violations.sort(
    (a, b) =>
      byCodeUnit(a.id, b.id) ||
      (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : byCodeUnit(a.path, b.path)) ||
      (a.line === b.line ? 0 : a.line === null ? -1 : b.line === null ? 1 : a.line - b.line) ||
      byCodeUnit(a.detail, b.detail),
  );
  // Keep the first 50 of each rule id in sorted order and count the rest. Path-less violations sort first, so they are
  // always kept.
  const omitted: PolicyEvaluation["omitted"] = {};
  const seen = new Map<PolicyRuleId, number>();
  violations = violations.filter((violation) => {
    const count = (seen.get(violation.id) ?? 0) + 1;
    seen.set(violation.id, count);
    if (count <= MAX_RULE_VIOLATIONS) return true;
    omitted[violation.id] = (omitted[violation.id] ?? 0) + 1;
    return false;
  });
  const evaluation: PolicyEvaluation = {
    violations,
    omitted,
    lowered: [...lowered].sort(byCodeUnit),
    ignored: [...(input.agentPolicy?.ignored ?? []), ...(consistency?.ignored ?? [])],
    ...(settings === undefined ? {} : { settings }),
  };
  if (input.agentPr !== null && input.agentPr !== undefined) {
    evaluation.agentPr = { evidence: [...input.agentPr.evidence], incomplete: input.agentPr.incomplete };
  }
  return evaluation;
}
