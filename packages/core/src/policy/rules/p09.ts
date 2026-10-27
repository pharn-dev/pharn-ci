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

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The distinct settings of one layer's ignored records, sorted: the first 5, then how many more. */
function settings(ignored: readonly IgnoredSetting[], layer: IgnoredSetting["layer"]): string {
  const names = [...new Set(ignored.filter((record) => record.layer === layer).map((record) => record.setting))].sort(
    byCodeUnit,
  );
  const shown = names.slice(0, MAX_SETTINGS).join(", ");
  return names.length > MAX_SETTINGS ? `${shown}, and ${names.length - MAX_SETTINGS} more` : shown;
}

/**
 * What P02 to P06 and the settings reader found, as P09 class 4 reads it: the paths that fail a rule (with the
 * strongest severity and the rule ids), the paths a reported error-level problem sits on, and the paths that supply a
 * required deny rule or hook.
 */
export interface SettingsView {
  failing: Map<string, { ids: PolicyRuleId[]; severity: PolicyViolationSeverity }>;
  uncheckable: Set<string>;
  supplying: Set<string>;
}

/**
 * P09, the pull request loosens the policy it is graded by. Four classes of edit in the diff: the policy file itself,
 * the config in use while a config setting is looser than the policy, a workflow while a workflow input is looser than
 * the policy, and a settings or MCP file the agent-settings rules read. Class 4 is a block, warn or info by what P02
 * to P06 found at HEAD (`view`), and item 22's warn (its direction is not judged) when the files were not read
 * (`view` null). A diff that is unavailable gives nothing.
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

  // 2. The config in use, while a config setting is looser than the policy.
  if (
    input.configPath !== null &&
    touched.has(input.configPath) &&
    input.ignored.some((record) => record.layer === "config")
  ) {
    findings.push({
      id: "P09",
      fallback: "block",
      path: input.configPath,
      line: null,
      detail: `this change edits the config, which sets ${settings(input.ignored, "config")} looser than the policy`,
    });
  }

  const paths = [...touched].sort(byCodeUnit);

  // 3. A workflow, while a workflow input is looser than the policy.
  if (input.ignored.some((record) => record.layer === "input")) {
    for (const path of paths) {
      if (!path.startsWith(WORKFLOWS_DIR)) continue;
      findings.push({
        id: "P09",
        fallback: "block",
        path,
        line: null,
        detail: `this change edits a workflow while a workflow input is looser than the policy (${settings(input.ignored, "input")})`,
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
    } else if (guarded) {
      const supplies = view.supplying.has(path);
      findings.push({
        id: "P09",
        fallback: supplies ? "warn" : "info",
        path,
        line: null,
        detail: supplies
          ? "this change edits a file that supplies a required deny rule or hook; a reviewer should confirm it"
          : "this change edits a file the policy checks; it complies",
      });
    }
  }
  return findings;
}
