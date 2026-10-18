import { describe, expect, it } from "vitest";

// AC tests for ai-agnostic-inventory (AC-10, AC-11): the tools credited per kind and the fixed tool list. The
// target is imported inside each test body so the file loads before the build; one `it` per AC.

type Summary = { byKind: Record<string, number>; tools: string[] };
type Summarize = (files: readonly { path: string; kind: string }[]) => Summary;

async function load() {
  return (await import("../src/setup/summary.js")) as unknown as {
    summarizeAgentSetup: Summarize;
    AGENT_TOOLS: readonly string[];
  };
}

// One representative path per kind, with the tools a single file of that kind must credit.
const CASES: readonly [kind: string, path: string, tools: string[]][] = [
  // The 13 new kinds.
  ["claude-rule", ".claude/rules/style.md", ["claude-code"]],
  ["aider-config", ".aider.conf.yml", ["aider"]],
  ["conventions-md", "CONVENTIONS.md", ["aider"]],
  ["continue-rules", ".continue/rules/style.md", ["continue"]],
  ["roo-rules", ".roorules", ["roo"]],
  ["amazonq-rules", ".amazonq/rules/a.md", ["amazon-q"]],
  ["junie-guidelines", ".junie/guidelines.md", ["junie"]],
  ["zed-rules", ".rules", ["zed"]],
  ["augment-rules", ".augment-guidelines", ["augment"]],
  ["kiro-steering", ".kiro/steering/product.md", ["kiro"]],
  ["goosehints", ".goosehints", ["goose"]],
  ["opencode-config", "opencode.json", ["opencode"]],
  ["gemini-settings", ".gemini/settings.json", ["gemini"]],
  // agents-md gains amp, jules, opencode and zed.
  ["agents-md", "AGENTS.md", ["amp", "codex", "copilot", "cursor", "jules", "opencode", "zed"]],
  // Every other existing kind keeps the tools it had before this change.
  ["claude-md", "CLAUDE.md", ["claude-code"]],
  ["claude-local-md", "CLAUDE.local.md", ["claude-code"]],
  ["claude-settings", ".claude/settings.json", ["claude-code"]],
  ["claude-settings-local", ".claude/settings.local.json", ["claude-code"]],
  ["claude-skill", ".claude/skills/release/SKILL.md", ["claude-code"]],
  ["claude-hook", ".claude/hooks/pre.sh", ["claude-code"]],
  ["claude-agent", ".claude/agents/reviewer.md", ["claude-code"]],
  ["claude-command", ".claude/commands/ship.md", ["claude-code"]],
  ["cursor-rules", ".cursorrules", ["cursor"]],
  ["cursor-mcp", ".cursor/mcp.json", ["cursor", "mcp"]],
  ["copilot-instructions", ".github/copilot-instructions.md", ["copilot"]],
  ["copilot-instructions-scoped", ".github/instructions/ts.instructions.md", ["copilot"]],
  ["copilot-agents", ".github/agents/reviewer.agent.md", ["copilot"]],
  ["copilot-prompts", ".github/prompts/release.prompt.md", ["copilot"]],
  ["vscode-mcp", ".vscode/mcp.json", ["copilot", "mcp"]],
  ["codex-config", ".codex/config.toml", ["codex"]],
  ["gemini-md", "GEMINI.md", ["gemini"]],
  ["windsurf-rules", ".windsurfrules", ["windsurf"]],
  ["cline-rules", ".clinerules", ["cline"]],
  ["mcp-config", ".mcp.json", ["mcp"]],
];

describe("agent setup summary tools (ai-agnostic-inventory)", () => {
  it("AC-10: credits each kind's tools for an inventory of exactly one file of that kind", async () => {
    const { summarizeAgentSetup } = await load();
    expect(CASES).toHaveLength(34);
    const actual = Object.fromEntries(CASES.map(([kind, path]) => [kind, summarizeAgentSetup([{ path, kind }]).tools]));
    const want = Object.fromEntries(CASES.map(([kind, , tools]) => [kind, tools]));
    expect(actual).toEqual(want);
  });

  it("AC-11: exports the fixed list of 20 agent tools", async () => {
    const { AGENT_TOOLS } = await load();
    expect([...AGENT_TOOLS].sort()).toEqual([
      "aider",
      "amazon-q",
      "amp",
      "augment",
      "claude-code",
      "cline",
      "codex",
      "continue",
      "copilot",
      "cursor",
      "gemini",
      "goose",
      "jules",
      "junie",
      "kiro",
      "mcp",
      "opencode",
      "roo",
      "windsurf",
      "zed",
    ]);
  });
});
