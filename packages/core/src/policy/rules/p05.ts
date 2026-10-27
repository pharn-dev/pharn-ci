import { mcpGlobMatches } from "../settings/mcp.js";
import type { SettingsModel } from "../settings/model.js";
import { shownPattern } from "./shown.js";
import type { RuleFinding } from "./types.js";

/** The strings of a server a P05 entry is matched against: its key, command, command line and url. */
export function serverTargets(server: {
  name: string;
  command: string | null;
  args: string[] | null;
  url: string | null;
}): string[] {
  const targets = [server.name];
  if (server.command !== null) {
    targets.push(server.command, [server.command, ...(server.args ?? [])].join(" "));
  }
  if (server.url !== null) targets.push(server.url);
  return targets;
}

/**
 * P05, forbidden MCP server. Each policy entry is a whole-string glob matched against each server's key, command,
 * command line and url (`env` and `headers` are never read), and against the name of an `enabledMcpjsonServers` entry.
 * One finding per server naming the first matching entry as the policy wrote it.
 */
export function detectP05(model: SettingsModel, forbidden: readonly string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const distinct = [...new Set(forbidden)];
  const judge = (path: string, line: number, targets: string[]) => {
    const hits = distinct.filter((entry) => targets.some((target) => mcpGlobMatches(entry, target)));
    if (hits.length === 0) return;
    const more = hits.length > 1 ? ` and ${hits.length - 1} more` : "";
    findings.push({
      id: "P05",
      fallback: "block",
      path,
      line,
      detail: `MCP server matches forbidden entry ${shownPattern(hits[0] as string)}${more}`,
    });
  };
  for (const server of model.mcpServers) judge(server.path, server.line, serverTargets(server));
  for (const unit of model.units) {
    for (const entry of unit.enabledMcpjsonServers) judge(entry.path, entry.line, [entry.text]);
  }
  return findings;
}
