import type { IgnoredSetting } from "../resolved.js";
import type { PolicySetup } from "../types.js";
import type { PolicyRuleInput, RuleFinding } from "./types.js";

const WORKFLOWS_DIR = ".github/workflows/";
/** Agent settings files of any directory depth (`.claude/settings.json`, `.claude/settings.local.json`, ...). */
const CLAUDE_SETTINGS = /^(?:.*\/)?\.claude\/settings[^/]*\.json$/;
const MCP_FILES: ReadonlySet<string> = new Set([".mcp.json", ".cursor/mcp.json", ".vscode/mcp.json"]);
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
 * P09, the pull request loosens the policy it is graded by. Four classes of edit in the diff: the policy file itself,
 * the config in use while a config setting is looser than the policy, a workflow while a workflow input is looser than
 * the policy, and a file the agent-settings rules read (a warning: its direction is not judged yet). A diff that is
 * unavailable gives nothing.
 */
export function detectP09(input: PolicyRuleInput): RuleFinding[] {
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
        detail: `this change edits a workflow while a workflow input is looser than the policy (${settings(input.ignored, "input")})`,
      });
    }
  }

  // 4. A file the agent-settings rules will read.
  const setup = policy.document.setup;
  const guarded = setup !== undefined && SETTINGS_LISTS.some((key) => (setup[key]?.length ?? 0) > 0);
  if (guarded) {
    for (const path of paths) {
      if (!CLAUDE_SETTINGS.test(path) && !MCP_FILES.has(path)) continue;
      findings.push({
        id: "P09",
        fallback: "warn",
        path,
        detail: "this change edits a file the policy checks; its direction is not judged yet",
      });
    }
  }
  return findings;
}
