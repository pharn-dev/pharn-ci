import type { SettingsModel } from "../settings/model.js";
import type { RuleFinding } from "./types.js";

/**
 * P04, MCP server not allowlisted. Each server key of each MCP file, and each name in a settings file's
 * `enabledMcpjsonServers`, that is not exactly an allowlist entry; `disabledMcpjsonServers` never removes a server.
 * Fixed check: `enableAllProjectMcpServers: true` approves every project server.
 */
export function detectP04(model: SettingsModel, allowed: readonly string[]): RuleFinding[] {
  const listed = new Set(allowed);
  const findings: RuleFinding[] = [];
  const notListed = (path: string, line: number) =>
    findings.push({
      id: "P04",
      fallback: "block",
      path,
      line,
      detail: "MCP server is not on the policy's allowlist",
    });
  for (const server of model.mcpServers) if (!listed.has(server.name)) notListed(server.path, server.line);
  for (const unit of model.units) {
    for (const entry of unit.enabledMcpjsonServers) if (!listed.has(entry.text)) notListed(entry.path, entry.line);
    for (const flag of unit.enableAllProjectMcpServers) {
      findings.push({
        id: "P04",
        fallback: "block",
        path: flag.path,
        line: flag.line,
        detail: "enableAllProjectMcpServers approves every project MCP server",
      });
    }
  }
  return findings;
}
