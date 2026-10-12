export type AgentSetupKind =
  | "claude-md"
  | "agents-md"
  | "claude-settings"
  | "claude-settings-local"
  | "claude-skill"
  | "claude-hook"
  | "claude-agent"
  | "claude-command"
  | "cursor-rules"
  | "copilot-instructions"
  | "mcp-config";

export interface AgentSetupFile {
  path: string;
  kind: AgentSetupKind;
}

export interface AgentSetupInventory {
  files: AgentSetupFile[];
}

const DIR_KINDS: ReadonlyArray<[prefix: string, kind: AgentSetupKind]> = [
  [".claude/skills/", "claude-skill"],
  [".claude/hooks/", "claude-hook"],
  [".claude/agents/", "claude-agent"],
  [".claude/commands/", "claude-command"],
  [".cursor/rules/", "cursor-rules"],
];

const EXACT_KINDS: ReadonlyMap<string, AgentSetupKind> = new Map([
  [".claude/settings.json", "claude-settings"],
  [".claude/settings.local.json", "claude-settings-local"],
  [".cursorrules", "cursor-rules"],
  [".github/copilot-instructions.md", "copilot-instructions"],
  [".mcp.json", "mcp-config"],
]);

/** Classify a repo-relative path, or return null if it is not an agent setup file. */
export function classifySetupPath(path: string): AgentSetupKind | null {
  const exact = EXACT_KINDS.get(path);
  if (exact) return exact;
  for (const [prefix, kind] of DIR_KINDS) {
    if (path.startsWith(prefix) && path.length > prefix.length) return kind;
  }
  const base = path.slice(path.lastIndexOf("/") + 1);
  // Both files are hierarchical: tools read them from any directory.
  if (base === "CLAUDE.md") return "claude-md";
  if (base === "AGENTS.md") return "agents-md";
  return null;
}

/**
 * Detect agent setup files from a list of repo-relative paths (e.g. `git ls-files`).
 * Reports what exists; makes no judgments.
 */
export function scanAgentSetup(paths: readonly string[]): AgentSetupInventory {
  const files: AgentSetupFile[] = [];
  for (const path of new Set(paths)) {
    const kind = classifySetupPath(path);
    if (kind) files.push({ path, kind });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files };
}
