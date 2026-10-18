import type { AgentSetupFile, AgentSetupKind } from "./scan.js";

/** The agent tools a setup file can configure. A fixed list: summaries never carry input-derived names. */
export const AGENT_TOOLS = [
  "claude-code",
  "cursor",
  "copilot",
  "codex",
  "gemini",
  "windsurf",
  "cline",
  "mcp",
  "aider",
  "amazon-q",
  "amp",
  "augment",
  "continue",
  "goose",
  "jules",
  "junie",
  "kiro",
  "opencode",
  "roo",
  "zed",
] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];

/** Which tools read each kind of setup file. */
const KIND_TOOLS: Record<AgentSetupKind, readonly AgentTool[]> = {
  "claude-md": ["claude-code"],
  "claude-local-md": ["claude-code"],
  "claude-settings": ["claude-code"],
  "claude-settings-local": ["claude-code"],
  "claude-skill": ["claude-code"],
  "claude-hook": ["claude-code"],
  "claude-agent": ["claude-code"],
  "claude-command": ["claude-code"],
  "agents-md": ["amp", "codex", "copilot", "cursor", "jules", "opencode", "zed"],
  "cursor-rules": ["cursor"],
  "cursor-mcp": ["cursor", "mcp"],
  "copilot-instructions": ["copilot"],
  "copilot-instructions-scoped": ["copilot"],
  "copilot-agents": ["copilot"],
  "copilot-prompts": ["copilot"],
  "vscode-mcp": ["copilot", "mcp"],
  "codex-config": ["codex"],
  "gemini-md": ["gemini"],
  "windsurf-rules": ["windsurf"],
  "cline-rules": ["cline"],
  "mcp-config": ["mcp"],
  "claude-rule": ["claude-code"],
  "aider-config": ["aider"],
  "conventions-md": ["aider"],
  "continue-rules": ["continue"],
  "roo-rules": ["roo"],
  "amazonq-rules": ["amazon-q"],
  "junie-guidelines": ["junie"],
  "zed-rules": ["zed"],
  "augment-rules": ["augment"],
  "kiro-steering": ["kiro"],
  goosehints: ["goose"],
  "opencode-config": ["opencode"],
  "gemini-settings": ["gemini"],
};

export interface AgentSetupSummary {
  /** File count per kind; only kinds that are present, in sorted key order. */
  byKind: Partial<Record<AgentSetupKind, number>>;
  /** Distinct tools the present kinds configure, sorted. */
  tools: AgentTool[];
}

/** Derive counts per kind and the tools involved from an inventory. Pure. */
export function summarizeAgentSetup(files: readonly AgentSetupFile[]): AgentSetupSummary {
  const counts = new Map<AgentSetupKind, number>();
  for (const f of files) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);

  const byKind: Partial<Record<AgentSetupKind, number>> = {};
  const tools = new Set<AgentTool>();
  for (const [kind, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    byKind[kind] = count;
    for (const tool of KIND_TOOLS[kind] ?? []) tools.add(tool);
  }
  return { byKind, tools: [...tools].sort() };
}
