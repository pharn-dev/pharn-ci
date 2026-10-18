import { describe, expect, it } from "vitest";

// F-10, inventory quality. classifySetupPath is loaded inside each test body: the AC tests are written before the
// build, so nothing that depends on the new classification may run while the file loads. Each test compares a whole
// path -> kind table, so a failure shows every path that classifies differently.

async function classifyAll(paths: readonly string[]): Promise<Record<string, string | null>> {
  const { classifySetupPath } = await import("../src/setup/scan.js");
  return Object.fromEntries(paths.map((path) => [path, classifySetupPath(path)]));
}

describe("inventory quality: placeholders under directory rules", () => {
  it("AC-1: a dotfile or README under any directory rule is not inventory", async () => {
    // One placeholder under each directory rule the SPEC lists, in dotfile and README spellings (README matched
    // case-insensitively, bare or with an extension).
    const placeholders = [
      ".claude/skills/demo/.gitkeep",
      ".claude/hooks/.gitkeep",
      ".claude/agents/README.md",
      ".claude/commands/readme.md",
      ".claude/rules/.gitkeep",
      ".cursor/rules/README.md",
      ".github/agents/readme.md",
      ".github/prompts/.gitkeep",
      ".windsurf/rules/README",
      ".clinerules/.gitkeep",
      ".continue/rules/README.MD",
      ".roo/rules/.keep",
      ".roo/rules-code/README.md",
      ".amazonq/rules/.gitkeep",
      ".augment/rules/Readme.md",
      ".kiro/steering/.DS_Store",
    ];
    const actual = await classifyAll(placeholders);
    expect(actual).toEqual(Object.fromEntries(placeholders.map((path) => [path, null])));
  });

  it("AC-1: a placeholder stops at its directory rule with no fall-through, while real files and root dot-files still classify", async () => {
    const expected: Record<string, string | null> = {
      // Placeholders named in the SPEC: null, including names a later file-name rule would otherwise match.
      ".claude/rules/.gitkeep": null,
      ".cursor/rules/README.md": null,
      ".github/agents/readme.md": null,
      ".kiro/steering/.DS_Store": null,
      ".claude/skills/demo/.mcp.json": null,
      ".roo/rules/.goosehints": null,
      // Real files under directory rules still count; "readme-" is not a README placeholder.
      ".claude/rules/style.md": "claude-rule",
      ".cursor/rules/readme-guide.mdc": "cursor-rules",
      ".github/agents/reviewer.agent.md": "copilot-agents",
      // Root dot-files are not under a directory rule, so the placeholder test never applies to them.
      ".clinerules": "cline-rules",
      ".roorules": "roo-rules",
      ".rules": "zed-rules",
      ".goosehints": "goosehints",
    };
    const actual = await classifyAll(Object.keys(expected));
    expect(actual).toEqual(expected);
  });
});

describe("inventory quality: root-only settings and MCP, node_modules excluded", () => {
  it("AC-2: .mcp.json and the Claude settings files count only at the repo root", async () => {
    const expected: Record<string, string | null> = {
      ".mcp.json": "mcp-config",
      ".claude/settings.json": "claude-settings",
      ".claude/settings.local.json": "claude-settings-local",
      "packages/web/.mcp.json": null,
      "test/fixtures/.mcp.json": null,
      "packages/web/.claude/settings.json": null,
      "src/.claude/settings.local.json": null,
    };
    const actual = await classifyAll(Object.keys(expected));
    expect(actual).toEqual(expected);
  });

  it("AC-2: a path with a node_modules directory segment is not inventory, while other nested rules still count", async () => {
    const expected: Record<string, string | null> = {
      "node_modules/x/CLAUDE.md": null,
      "packages/a/node_modules/b/AGENTS.md": null,
      "node_modules/.claude/skills/x/SKILL.md": null,
      // Nested rules other than settings/MCP are unchanged.
      "packages/web/CLAUDE.md": "claude-md",
      "packages/web/.claude/skills/x/SKILL.md": "claude-skill",
      // Only a whole segment named node_modules excludes a path.
      "my_node_modules/CLAUDE.md": "claude-md",
    };
    const actual = await classifyAll(Object.keys(expected));
    expect(actual).toEqual(expected);
  });
});
