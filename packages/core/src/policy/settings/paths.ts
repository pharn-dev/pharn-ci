import type { PolicyDocument } from "../types.js";

const SETTINGS_PATH = /^(?:.*\/)?\.claude\/settings(?:\.local)?\.json$/;
const MCP_PATH = /^(?:.*\/)?(?:\.mcp\.json|\.cursor\/mcp\.json|\.vscode\/mcp\.json)$/;
const JSONC_MCP_PATH = /^(?:.*\/)?(?:\.cursor|\.vscode)\/mcp\.json$/;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `.claude/settings.json` or `.claude/settings.local.json`, at the root or nested. */
export function isPolicySettingsPath(path: string): boolean {
  return SETTINGS_PATH.test(path);
}

/** `.mcp.json`, `.cursor/mcp.json` or `.vscode/mcp.json`, at the root or nested. */
export function isPolicyMcpPath(path: string): boolean {
  return MCP_PATH.test(path);
}

/** The MCP files parsed as JSONC (`.cursor/mcp.json`, `.vscode/mcp.json`); the settings and `.mcp.json` are strict. */
export function isJsoncMcpPath(path: string): boolean {
  return JSONC_MCP_PATH.test(path);
}

/**
 * The tracked paths policy mode reads: every settings path, plus the MCP paths when the policy lists MCP servers.
 * Distinct and sorted in code-unit order.
 */
export function policySettingsPaths(repoFiles: readonly string[], document: PolicyDocument): string[] {
  const setup = document.setup;
  const mcp = (setup?.allowed_mcp_servers?.length ?? 0) > 0 || (setup?.forbidden_mcp_servers?.length ?? 0) > 0;
  const paths = new Set<string>();
  for (const path of repoFiles) {
    if (isPolicySettingsPath(path) || (mcp && isPolicyMcpPath(path))) paths.add(path);
  }
  return [...paths].sort(byCodeUnit);
}

/** The text before `.claude/settings…`: `""` for the root unit, `pkg/a/` for `pkg/a/.claude/settings.json`. */
export function settingsUnitAnchor(path: string): string {
  const at = path.lastIndexOf(".claude/settings");
  return at === -1 ? "" : path.slice(0, at);
}
