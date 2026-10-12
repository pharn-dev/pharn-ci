import { describe, expect, it } from "vitest";

// AC tests for agent-setup-inventory (AC-1..AC-6). Targets are imported inside each test body so the
// file loads before the build; one `it` per AC.

type Classify = (path: string) => string | null;
type Rule = { kind: string; matches(path: string): boolean };

async function classifier(): Promise<Classify> {
  const mod = (await import("../src/setup/scan.js")) as unknown as { classifySetupPath: Classify };
  return mod.classifySetupPath;
}

function classifyAll(classify: Classify, paths: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(paths.map((p) => [p, classify(p)]));
}

describe("agent setup classification (agent-setup-inventory)", () => {
  it("AC-1: classifies CLAUDE.local.md and GEMINI.md at the root and nested", async () => {
    const classify = await classifier();
    expect(
      classifyAll(classify, ["CLAUDE.local.md", "packages/web/CLAUDE.local.md", "GEMINI.md", "packages/web/GEMINI.md"]),
    ).toEqual({
      "CLAUDE.local.md": "claude-local-md",
      "packages/web/CLAUDE.local.md": "claude-local-md",
      "GEMINI.md": "gemini-md",
      "packages/web/GEMINI.md": "gemini-md",
    });
  });

  it("AC-2: classifies scoped Copilot instructions, custom agents and prompt files", async () => {
    const classify = await classifier();
    expect(
      classifyAll(classify, [
        ".github/instructions/ts.instructions.md",
        ".github/instructions/frontend/react.instructions.md",
        ".github/agents/reviewer.agent.md",
        ".github/agents/notes/extra.md",
        ".github/prompts/release.prompt.md",
        ".github/prompts/sub/x.md",
        ".github/instructions/notes.md",
      ]),
    ).toEqual({
      ".github/instructions/ts.instructions.md": "copilot-instructions-scoped",
      ".github/instructions/frontend/react.instructions.md": "copilot-instructions-scoped",
      ".github/agents/reviewer.agent.md": "copilot-agents",
      ".github/agents/notes/extra.md": "copilot-agents",
      ".github/prompts/release.prompt.md": "copilot-prompts",
      ".github/prompts/sub/x.md": "copilot-prompts",
      ".github/instructions/notes.md": null,
    });
  });

  it("AC-3: classifies editor MCP configs, Codex, Windsurf and Cline files, root only", async () => {
    const classify = await classifier();
    expect(
      classifyAll(classify, [
        ".cursor/mcp.json",
        ".vscode/mcp.json",
        ".codex/config.toml",
        ".windsurfrules",
        ".windsurf/rules/style.md",
        ".clinerules",
        ".clinerules/style.md",
        ".vscode/settings.json",
        ".codex/other.toml",
        ".windsurf/other.json",
        "packages/web/.cursor/mcp.json",
        "packages/web/.vscode/mcp.json",
        "gemini.md",
      ]),
    ).toEqual({
      ".cursor/mcp.json": "cursor-mcp",
      ".vscode/mcp.json": "vscode-mcp",
      ".codex/config.toml": "codex-config",
      ".windsurfrules": "windsurf-rules",
      ".windsurf/rules/style.md": "windsurf-rules",
      ".clinerules": "cline-rules",
      ".clinerules/style.md": "cline-rules",
      ".vscode/settings.json": null,
      ".codex/other.toml": null,
      ".windsurf/other.json": null,
      "packages/web/.cursor/mcp.json": null,
      "packages/web/.vscode/mcp.json": null,
      "gemini.md": null,
    });
  });

  it("AC-4: classifies .mcp.json, .claude/ kinds and .cursor/rules/ in nested directories", async () => {
    const classify = await classifier();
    expect(
      classifyAll(classify, [
        "packages/web/.mcp.json",
        "packages/web/.claude/settings.json",
        "packages/web/.claude/settings.local.json",
        "packages/web/.claude/skills/release/SKILL.md",
        "packages/web/.claude/hooks/pre.sh",
        "packages/web/.claude/agents/reviewer.md",
        "packages/web/.claude/commands/ship.md",
        "packages/web/.cursor/rules/style.mdc",
      ]),
    ).toEqual({
      "packages/web/.mcp.json": "mcp-config",
      "packages/web/.claude/settings.json": "claude-settings",
      "packages/web/.claude/settings.local.json": "claude-settings-local",
      "packages/web/.claude/skills/release/SKILL.md": "claude-skill",
      "packages/web/.claude/hooks/pre.sh": "claude-hook",
      "packages/web/.claude/agents/reviewer.md": "claude-agent",
      "packages/web/.claude/commands/ship.md": "claude-command",
      "packages/web/.cursor/rules/style.mdc": "cursor-rules",
    });
  });

  it("AC-5: keeps every previous match and non-match, decided by the first matching rule", async () => {
    const mod = (await import("../src/setup/scan.js")) as unknown as {
      classifySetupPath: Classify;
      SETUP_RULES: readonly Rule[];
    };
    const previous: Record<string, string> = {
      "CLAUDE.md": "claude-md",
      "packages/web/CLAUDE.md": "claude-md",
      "AGENTS.md": "agents-md",
      "services/api/AGENTS.md": "agents-md",
      ".claude/settings.json": "claude-settings",
      ".claude/settings.local.json": "claude-settings-local",
      ".claude/skills/release/SKILL.md": "claude-skill",
      ".claude/hooks/pre.sh": "claude-hook",
      ".claude/agents/reviewer.md": "claude-agent",
      ".claude/commands/ship.md": "claude-command",
      ".cursor/rules/style.mdc": "cursor-rules",
      ".cursorrules": "cursor-rules",
      ".github/copilot-instructions.md": "copilot-instructions",
      ".mcp.json": "mcp-config",
    };
    const nonMatches = [
      "README.md",
      "claude.md",
      "docs/CLAUDE.md.bak",
      ".claude/settings.json.example",
      ".claude/skills",
      ".cursor/other.json",
    ];

    const paths = Object.keys(previous);
    expect(classifyAll(mod.classifySetupPath, paths)).toEqual(previous);
    expect(classifyAll(mod.classifySetupPath, nonMatches)).toEqual(
      Object.fromEntries(nonMatches.map((p) => [p, null])),
    );

    // The classifier follows its own ordered rule table: the first matching rule decides.
    expect(Array.isArray(mod.SETUP_RULES)).toBe(true);
    const firstRuleKind = (p: string) => mod.SETUP_RULES.find((rule) => rule.matches(p))?.kind ?? null;
    expect(Object.fromEntries(paths.map((p) => [p, firstRuleKind(p)]))).toEqual(previous);
    expect(Object.fromEntries(nonMatches.map((p) => [p, mod.SETUP_RULES.some((rule) => rule.matches(p))]))).toEqual(
      Object.fromEntries(nonMatches.map((p) => [p, false])),
    );
  });

  it("AC-6: lets the more specific directory rule win over a file-name rule", async () => {
    const classify = await classifier();
    expect(
      classifyAll(classify, [
        ".github/agents/AGENTS.md",
        ".claude/agents/CLAUDE.md",
        ".clinerules/AGENTS.md",
        ".claude/skills/demo/.mcp.json",
        ".windsurf/rules/GEMINI.md",
      ]),
    ).toEqual({
      ".github/agents/AGENTS.md": "copilot-agents",
      ".claude/agents/CLAUDE.md": "claude-agent",
      ".clinerules/AGENTS.md": "cline-rules",
      ".claude/skills/demo/.mcp.json": "claude-skill",
      ".windsurf/rules/GEMINI.md": "windsurf-rules",
    });
  });
});
