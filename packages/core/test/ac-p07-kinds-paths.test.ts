import { describe, expect, it } from "vitest";

// E3 item 24 (P07), AC-8. The core index is loaded inside the test body: the AC test is written before the build adds
// the instruction module, so nothing the build adds may run while this file loads.

type SetupFile = { path: string; kind: string };
type Inventory = { files: SetupFile[] };
interface Core {
  INSTRUCTION_KINDS: readonly string[];
  instructionScope(file: SetupFile): string;
  agentInstructionPaths(inventory: Inventory): string[];
  scanAgentSetup(paths: readonly string[]): Inventory;
}

describe("org policy rule P07: instruction kinds, scopes and the paths it reads", { timeout: 60_000 }, () => {
  it("AC-8: INSTRUCTION_KINDS is the fixed list, instructionScope gives the root or the package directory, and agentInstructionPaths keeps the instruction files of scopes holding two or more, sorted", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;

    expect([...core.INSTRUCTION_KINDS]).toEqual([
      "claude-md",
      "claude-local-md",
      "agents-md",
      "gemini-md",
      "goosehints",
      "cursor-rules",
      "claude-rule",
      "copilot-instructions",
      "copilot-instructions-scoped",
      "windsurf-rules",
      "cline-rules",
      "conventions-md",
      "continue-rules",
      "roo-rules",
      "amazonq-rules",
      "junie-guidelines",
      "zed-rules",
      "augment-rules",
      "kiro-steering",
    ]);

    const fileOf = (path: string): SetupFile => {
      const files = core.scanAgentSetup([path]).files;
      expect(
        files.map((f) => f.path),
        path,
      ).toEqual([path]);
      return files[0] as SetupFile;
    };
    for (const path of ["CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md"]) {
      expect(core.instructionScope(fileOf(path)), path).toBe("");
    }
    for (const path of [
      "packages/web/AGENTS.md",
      "packages/web/.cursor/rules/a.mdc",
      "packages/web/.claude/rules/b.md",
    ]) {
      expect(core.instructionScope(fileOf(path)), path).toBe("packages/web/");
    }

    const inventory = core.scanAgentSetup([
      "AGENTS.md",
      "CLAUDE.md",
      "packages/a/AGENTS.md",
      ".claude/skills/x/SKILL.md",
      ".claude/commands/c.md",
      ".continue/rules/r.json",
      ".continue/rules/r.md",
      ".mcp.json",
    ]);
    expect(core.agentInstructionPaths(inventory)).toEqual([".continue/rules/r.md", "AGENTS.md", "CLAUDE.md"]);
  });
});
