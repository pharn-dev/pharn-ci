export type AgentSetupKind =
  | "claude-md"
  | "claude-local-md"
  | "agents-md"
  | "gemini-md"
  | "claude-settings"
  | "claude-settings-local"
  | "claude-skill"
  | "claude-hook"
  | "claude-agent"
  | "claude-command"
  | "cursor-rules"
  | "cursor-mcp"
  | "copilot-instructions"
  | "copilot-instructions-scoped"
  | "copilot-agents"
  | "copilot-prompts"
  | "vscode-mcp"
  | "codex-config"
  | "windsurf-rules"
  | "cline-rules"
  | "mcp-config"
  | "claude-rule"
  | "aider-config"
  | "conventions-md"
  | "continue-rules"
  | "roo-rules"
  | "amazonq-rules"
  | "junie-guidelines"
  | "zed-rules"
  | "augment-rules"
  | "kiro-steering"
  | "goosehints"
  | "opencode-config"
  | "gemini-settings";

export interface AgentSetupFile {
  path: string;
  kind: AgentSetupKind;
}

export interface AgentSetupInventory {
  files: AgentSetupFile[];
}

/** One way a path becomes an agent setup file. */
export interface SetupRule {
  kind: AgentSetupKind;
  matches(path: string): boolean;
}

// Matching uses string operations only: a regex `.` would not match line terminators, and git allows
// them in file names. Such paths must still be classified (the renderer neutralizes them).

/** True when `anchor` (e.g. ".claude/skills/") starts the path or follows a "/" and something follows it. */
function underNested(path: string, anchor: string): boolean {
  let from = 0;
  for (;;) {
    const i = path.indexOf(anchor, from);
    if (i === -1) return false;
    if ((i === 0 || path[i - 1] === "/") && path.length > i + anchor.length) return true;
    from = i + 1;
  }
}

/** True when `file` is the whole path or its tail after a "/". */
function isNestedFile(path: string, file: string): boolean {
  return path === file || path.endsWith(`/${file}`);
}

/** True when the path is under the repo-root directory `prefix` (e.g. ".github/agents/") with a non-empty rest. */
function underRoot(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && path.length > prefix.length;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** True for a repo-root `.roo/rules-<mode>/<file>` path: a non-empty mode, then "/" and a non-empty rest. */
function underRooModeDir(path: string): boolean {
  const prefix = ".roo/rules-";
  if (!path.startsWith(prefix)) return false;
  const slash = path.indexOf("/", prefix.length);
  return slash > prefix.length && path.length > slash + 1;
}

/** True for a repo-root `.roorules-<mode>` file: a non-empty mode and no "/". */
function isRooModeFile(path: string): boolean {
  const prefix = ".roorules-";
  return path.startsWith(prefix) && path.length > prefix.length && !path.includes("/");
}

const INSTRUCTIONS_DIR = ".github/instructions/";
const INSTRUCTIONS_SUFFIX = ".instructions.md";

/**
 * The classification rules, in precedence order: the first rule that matches decides. Rules anchored to a
 * directory or a full path come before the file-name rules, so the more specific location wins
 * (`.claude/agents/CLAUDE.md` is a Claude agent, not a CLAUDE.md).
 */
export const SETUP_RULES: readonly SetupRule[] = [
  // Directory and full-path rules that also apply in nested directories (the .claude/ kinds, claude-rule
  // among them, and cursor-rules).
  { kind: "claude-settings", matches: (p) => isNestedFile(p, ".claude/settings.json") },
  { kind: "claude-settings-local", matches: (p) => isNestedFile(p, ".claude/settings.local.json") },
  { kind: "claude-skill", matches: (p) => underNested(p, ".claude/skills/") },
  { kind: "claude-hook", matches: (p) => underNested(p, ".claude/hooks/") },
  { kind: "claude-agent", matches: (p) => underNested(p, ".claude/agents/") },
  { kind: "claude-command", matches: (p) => underNested(p, ".claude/commands/") },
  { kind: "claude-rule", matches: (p) => underNested(p, ".claude/rules/") },
  { kind: "cursor-rules", matches: (p) => underNested(p, ".cursor/rules/") },
  // Directory and full-path rules for the repo root only (including the aider, continue, roo, amazonq, junie,
  // zed, augment, kiro, opencode and gemini-settings kinds).
  { kind: "cursor-rules", matches: (p) => p === ".cursorrules" },
  { kind: "copilot-instructions", matches: (p) => p === ".github/copilot-instructions.md" },
  {
    kind: "copilot-instructions-scoped",
    matches: (p) =>
      p.startsWith(INSTRUCTIONS_DIR) &&
      p.endsWith(INSTRUCTIONS_SUFFIX) &&
      p.length > INSTRUCTIONS_DIR.length + INSTRUCTIONS_SUFFIX.length,
  },
  { kind: "copilot-agents", matches: (p) => underRoot(p, ".github/agents/") },
  { kind: "copilot-prompts", matches: (p) => underRoot(p, ".github/prompts/") },
  { kind: "cursor-mcp", matches: (p) => p === ".cursor/mcp.json" },
  { kind: "vscode-mcp", matches: (p) => p === ".vscode/mcp.json" },
  { kind: "codex-config", matches: (p) => p === ".codex/config.toml" },
  { kind: "windsurf-rules", matches: (p) => p === ".windsurfrules" },
  { kind: "windsurf-rules", matches: (p) => underRoot(p, ".windsurf/rules/") },
  { kind: "cline-rules", matches: (p) => p === ".clinerules" },
  { kind: "cline-rules", matches: (p) => underRoot(p, ".clinerules/") },
  { kind: "aider-config", matches: (p) => p === ".aider.conf.yml" },
  { kind: "conventions-md", matches: (p) => p === "CONVENTIONS.md" },
  { kind: "continue-rules", matches: (p) => underRoot(p, ".continue/rules/") },
  { kind: "continue-rules", matches: (p) => p === ".continuerules" },
  { kind: "roo-rules", matches: (p) => p === ".roorules" },
  { kind: "roo-rules", matches: isRooModeFile },
  { kind: "roo-rules", matches: (p) => underRoot(p, ".roo/rules/") },
  { kind: "roo-rules", matches: underRooModeDir },
  { kind: "amazonq-rules", matches: (p) => underRoot(p, ".amazonq/rules/") },
  { kind: "junie-guidelines", matches: (p) => p === ".junie/guidelines.md" },
  { kind: "zed-rules", matches: (p) => p === ".rules" },
  { kind: "augment-rules", matches: (p) => underRoot(p, ".augment/rules/") },
  { kind: "augment-rules", matches: (p) => p === ".augment-guidelines" },
  { kind: "kiro-steering", matches: (p) => underRoot(p, ".kiro/steering/") },
  { kind: "opencode-config", matches: (p) => p === "opencode.json" },
  { kind: "opencode-config", matches: (p) => p === "opencode.jsonc" },
  { kind: "gemini-settings", matches: (p) => p === ".gemini/settings.json" },
  // File-name rules: these files are hierarchical, so tools read them from any directory (goosehints included).
  { kind: "claude-md", matches: (p) => baseName(p) === "CLAUDE.md" },
  { kind: "claude-local-md", matches: (p) => baseName(p) === "CLAUDE.local.md" },
  { kind: "agents-md", matches: (p) => baseName(p) === "AGENTS.md" },
  { kind: "gemini-md", matches: (p) => baseName(p) === "GEMINI.md" },
  { kind: "mcp-config", matches: (p) => baseName(p) === ".mcp.json" },
  { kind: "goosehints", matches: (p) => baseName(p) === ".goosehints" },
];

/** Classify a repo-relative path, or return null if it is not an agent setup file. */
export function classifySetupPath(path: string): AgentSetupKind | null {
  for (const rule of SETUP_RULES) {
    if (rule.matches(path)) return rule.kind;
  }
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
