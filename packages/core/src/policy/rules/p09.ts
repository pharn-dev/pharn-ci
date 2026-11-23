import { byCodeUnit } from "../../text.js";
import type { IgnoredSetting } from "../resolved.js";
import { isPolicyMcpPath, isPolicySettingsPath } from "../settings/paths.js";
import type { PolicyRuleId, PolicySetup } from "../types.js";
import type { PolicyRuleInput, PolicyViolationSeverity, RuleFinding } from "./types.js";

const WORKFLOWS_DIR = ".github/workflows/";
/** The most settings a class-2 or class-3 detail names; the rest are counted. */
const MAX_SETTINGS = 5;

/** The `setup` lists the agent-settings rules read: a non-empty one makes an edit of those files worth a warning. */
const SETTINGS_LISTS = [
  "forbidden_permissions",
  "required_permissions_deny",
  "allowed_mcp_servers",
  "forbidden_mcp_servers",
  "required_hooks",
] as const satisfies readonly (keyof PolicySetup)[];

/** The distinct settings of the records, sorted: the first 5, then how many more. */
function settings(looser: readonly IgnoredSetting[]): string {
  const names = [...new Set(looser.map((record) => record.setting))].sort(byCodeUnit);
  const shown = names.slice(0, MAX_SETTINGS).join(", ");
  return names.length > MAX_SETTINGS ? `${shown}, and ${names.length - MAX_SETTINGS} more` : shown;
}

/**
 * What P02 to P06 and the settings reader found, as P09 class 4 reads it: the paths that fail a rule (with the
 * strongest severity and the rule ids) and the paths a reported error-level problem sits on.
 */
export interface SettingsView {
  failing: Map<string, { ids: PolicyRuleId[]; severity: PolicyViolationSeverity }>;
  uncheckable: Set<string>;
}

/**
 * P09, the pull request loosens the policy it is graded by. Four classes of edit in the diff: the policy file itself,
 * the config in use and a workflow while a setting of the workflow inputs or the config is looser than an app policy
 * (which of the two layers gave it is not recorded since CORE-123, so either edit counts, the stricter reading), and a
 * settings or MCP file the agent-settings rules read. Class 4 is a violation only when P02 to P06
 * found the file failing a rule at HEAD (that rule's severity) or could not check it (a block); an edited file that
 * complies gives nothing (CORE-123). When the files were not read (`view` null) it is item 22's warn (its direction is
 * not judged). A diff that is unavailable gives nothing.
 */
export function detectP09(input: PolicyRuleInput, view: SettingsView | null): RuleFinding[] {
  const { policy, diff } = input;
  if ((policy.source !== "app" && policy.source !== "file") || policy.document === null || diff === null) return [];
  const touched = new Set<string>();
  for (const file of diff) {
    touched.add(file.path);
    touched.add(file.oldPath);
  }
  const findings: RuleFinding[] = [];

  // 1. The policy file this change is checked against.
  if (policy.source === "file" && typeof policy.path === "string" && touched.has(policy.path)) {
    findings.push({
      id: "P09",
      fallback: "block",
      path: policy.path,
      line: null,
      detail: "this change edits the policy file it is checked against",
    });
  }

  // A looser record of an app policy is a workflow input or config value it beat; a policy file's records are its own
  // values, which classes 2 and 3 do not read.
  const looser = policy.source === "app" ? input.ignored.filter((record) => record.reason === "looser") : [];

  // 2. The config in use, while a setting is looser than the policy.
  if (input.configPath !== null && touched.has(input.configPath) && looser.length > 0) {
    findings.push({
      id: "P09",
      fallback: "block",
      path: input.configPath,
      line: null,
      detail: `this change edits the config while a setting is looser than the policy (${settings(looser)})`,
    });
  }

  const paths = [...touched].sort(byCodeUnit);

  // 3. A workflow, while a setting is looser than the policy.
  if (looser.length > 0) {
    for (const path of paths) {
      if (!path.startsWith(WORKFLOWS_DIR)) continue;
      findings.push({
        id: "P09",
        fallback: "block",
        path,
        line: null,
        detail: `this change edits a workflow while a setting is looser than the policy (${settings(looser)})`,
      });
    }
  }

  // 4. A file the agent-settings rules will read.
  const setup = policy.document.setup;
  const guarded = setup !== undefined && SETTINGS_LISTS.some((key) => (setup[key]?.length ?? 0) > 0);
  for (const path of paths) {
    if (!isPolicySettingsPath(path) && !isPolicyMcpPath(path)) continue;
    if (view === null) {
      if (!guarded) continue;
      findings.push({
        id: "P09",
        fallback: "warn",
        path,
        line: null,
        detail: "this change edits a file the policy checks; its direction is not judged yet",
      });
      continue;
    }
    const failing = view.failing.get(path);
    if (failing !== undefined) {
      const ids = [...new Set(failing.ids)].sort(byCodeUnit);
      findings.push({
        id: "P09",
        fallback: view.uncheckable.has(path) ? "block" : failing.severity,
        path,
        line: null,
        detail: `this change edits a file that fails ${ids.join(", ")}`,
      });
    } else if (view.uncheckable.has(path)) {
      findings.push({
        id: "P09",
        fallback: "block",
        path,
        line: null,
        detail: "this change edits a file the policy could not check",
      });
    }
  }
  return findings;
}
