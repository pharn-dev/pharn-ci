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
  /**
   * True for a rule that matches every file under a directory. A placeholder there (a dot-file such as
   * `.gitkeep`, or a README) is not agent setup; see `classifySetupPath`.
   */
  directory?: true;
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

/** True when a `/`-separated segment of the path is exactly `node_modules` (installed packages, not the repo's own setup). */
function hasNodeModulesSegment(path: string): boolean {
  return path.split("/").includes("node_modules");
}

/** True for a placeholder file name: a dot-file (`.gitkeep`, `.DS_Store`), or a README with or without an extension. */
function isPlaceholderName(name: string): boolean {
  if (name.startsWith(".")) return true;
  const lower = name.toLowerCase();
  return lower === "readme" || lower.startsWith("readme.");
}

/**
 * The classification rules, in precedence order: the first rule that matches decides. Rules anchored to a
 * directory or a full path come before the file-name rules, so the more specific location wins
 * (`.claude/agents/CLAUDE.md` is a Claude agent, not a CLAUDE.md).
 */
export const SETUP_RULES: readonly SetupRule[] = [
  // Directory and full-path rules that also apply in nested directories (the .claude/ kinds, claude-rule
  // among them, and cursor-rules). The settings and MCP files are not here: they count at the repo root only.
  { kind: "claude-skill", matches: (p) => underNested(p, ".claude/skills/"), directory: true },
  { kind: "claude-hook", matches: (p) => underNested(p, ".claude/hooks/"), directory: true },
  { kind: "claude-agent", matches: (p) => underNested(p, ".claude/agents/"), directory: true },
  { kind: "claude-command", matches: (p) => underNested(p, ".claude/commands/"), directory: true },
  { kind: "claude-rule", matches: (p) => underNested(p, ".claude/rules/"), directory: true },
  { kind: "cursor-rules", matches: (p) => underNested(p, ".cursor/rules/"), directory: true },
  // Directory and full-path rules for the repo root only (including the claude-settings, claude-settings-local,
  // mcp-config, aider, continue, roo, amazonq, junie, zed, augment, kiro, opencode and gemini-settings kinds).
  { kind: "claude-settings", matches: (p) => p === ".claude/settings.json" },
  { kind: "claude-settings-local", matches: (p) => p === ".claude/settings.local.json" },
  { kind: "mcp-config", matches: (p) => p === ".mcp.json" },
  { kind: "cursor-rules", matches: (p) => p === ".cursorrules" },
  { kind: "copilot-instructions", matches: (p) => p === ".github/copilot-instructions.md" },
  {
    kind: "copilot-instructions-scoped",
    matches: (p) =>
      p.startsWith(INSTRUCTIONS_DIR) &&
      p.endsWith(INSTRUCTIONS_SUFFIX) &&
      p.length > INSTRUCTIONS_DIR.length + INSTRUCTIONS_SUFFIX.length,
  },
  { kind: "copilot-agents", matches: (p) => underRoot(p, ".github/agents/"), directory: true },
  { kind: "copilot-prompts", matches: (p) => underRoot(p, ".github/prompts/"), directory: true },
  { kind: "cursor-mcp", matches: (p) => p === ".cursor/mcp.json" },
  { kind: "vscode-mcp", matches: (p) => p === ".vscode/mcp.json" },
  { kind: "codex-config", matches: (p) => p === ".codex/config.toml" },
  { kind: "windsurf-rules", matches: (p) => p === ".windsurfrules" },
  { kind: "windsurf-rules", matches: (p) => underRoot(p, ".windsurf/rules/"), directory: true },
  { kind: "cline-rules", matches: (p) => p === ".clinerules" },
  { kind: "cline-rules", matches: (p) => underRoot(p, ".clinerules/"), directory: true },
  { kind: "aider-config", matches: (p) => p === ".aider.conf.yml" },
  { kind: "conventions-md", matches: (p) => p === "CONVENTIONS.md" },
  { kind: "continue-rules", matches: (p) => underRoot(p, ".continue/rules/"), directory: true },
  { kind: "continue-rules", matches: (p) => p === ".continuerules" },
  { kind: "roo-rules", matches: (p) => p === ".roorules" },
  { kind: "roo-rules", matches: isRooModeFile },
  { kind: "roo-rules", matches: (p) => underRoot(p, ".roo/rules/"), directory: true },
  { kind: "roo-rules", matches: underRooModeDir, directory: true },
  { kind: "amazonq-rules", matches: (p) => underRoot(p, ".amazonq/rules/"), directory: true },
  { kind: "junie-guidelines", matches: (p) => p === ".junie/guidelines.md" },
  { kind: "zed-rules", matches: (p) => p === ".rules" },
  { kind: "augment-rules", matches: (p) => underRoot(p, ".augment/rules/"), directory: true },
  { kind: "augment-rules", matches: (p) => p === ".augment-guidelines" },
  { kind: "kiro-steering", matches: (p) => underRoot(p, ".kiro/steering/"), directory: true },
  { kind: "opencode-config", matches: (p) => p === "opencode.json" },
  { kind: "opencode-config", matches: (p) => p === "opencode.jsonc" },
  { kind: "gemini-settings", matches: (p) => p === ".gemini/settings.json" },
  // File-name rules: these files are hierarchical, so tools read them from any directory (goosehints included).
  { kind: "claude-md", matches: (p) => baseName(p) === "CLAUDE.md" },
  { kind: "claude-local-md", matches: (p) => baseName(p) === "CLAUDE.local.md" },
  { kind: "agents-md", matches: (p) => baseName(p) === "AGENTS.md" },
  { kind: "gemini-md", matches: (p) => baseName(p) === "GEMINI.md" },
  { kind: "goosehints", matches: (p) => baseName(p) === ".goosehints" },
];

/**
 * Classify a repo-relative path, or return null if it is not an agent setup file. A path with a `node_modules`
 * directory segment is never one. A placeholder (see `isPlaceholderName`) under a directory rule is not one
 * either, and does not fall through to a later file-name rule.
 */
export function classifySetupPath(path: string): AgentSetupKind | null {
  if (hasNodeModulesSegment(path)) return null;
  for (const rule of SETUP_RULES) {
    if (!rule.matches(path)) continue;
    if (rule.directory === true && isPlaceholderName(baseName(path))) return null;
    return rule.kind;
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
