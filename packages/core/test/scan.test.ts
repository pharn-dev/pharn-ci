import { describe, expect, it } from "vitest";
import { classifySetupPath, scanAgentSetup } from "../src/setup/scan.js";
import { fixture } from "./helpers.js";

describe("classifySetupPath", () => {
  it.each([
    ["CLAUDE.md", "claude-md"],
    ["packages/web/CLAUDE.md", "claude-md"],
    ["AGENTS.md", "agents-md"],
    ["services/api/AGENTS.md", "agents-md"],
    [".claude/settings.json", "claude-settings"],
    [".claude/settings.local.json", "claude-settings-local"],
    [".claude/skills/release/SKILL.md", "claude-skill"],
    [".claude/hooks/pre.sh", "claude-hook"],
    [".claude/agents/reviewer.md", "claude-agent"],
    [".claude/commands/ship.md", "claude-command"],
    [".cursor/rules/style.mdc", "cursor-rules"],
    [".cursorrules", "cursor-rules"],
    [".github/copilot-instructions.md", "copilot-instructions"],
    [".mcp.json", "mcp-config"],
    ["src/.claude/settings.json", "claude-settings"],
    ["nested/.mcp.json", "mcp-config"],
  ])("%s -> %s", (path, kind) => {
    expect(classifySetupPath(path)).toBe(kind);
  });

  it.each([
    "README.md",
    "claude.md",
    "docs/CLAUDE.md.bak",
    ".claude/settings.json.example",
    ".claude/skills",
    ".cursor/other.json",
  ])("ignores %s", (path) => {
    expect(classifySetupPath(path)).toBeNull();
  });
});

describe("scanAgentSetup", () => {
  it("returns sorted, de-duplicated agent setup files", () => {
    const paths = fixture("golden/files.txt").trim().split("\n");
    const { files } = scanAgentSetup([...paths, "CLAUDE.md"]);
    expect(files).toEqual([
      { path: ".claude/settings.json", kind: "claude-settings" },
      { path: ".claude/skills/release/SKILL.md", kind: "claude-skill" },
      { path: ".cursor/rules/style.mdc", kind: "cursor-rules" },
      { path: ".github/copilot-instructions.md", kind: "copilot-instructions" },
      { path: ".mcp.json", kind: "mcp-config" },
      { path: "AGENTS.md", kind: "agents-md" },
      { path: "CLAUDE.md", kind: "claude-md" },
      { path: "packages/web/CLAUDE.md", kind: "claude-md" },
    ]);
  });

  it("returns an empty inventory when nothing matches", () => {
    expect(scanAgentSetup(["src/a.ts"])).toEqual({ files: [] });
  });
});
