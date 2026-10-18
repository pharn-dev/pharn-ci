import { describe, expect, it } from "vitest";

// AC tests for ai-agnostic-inventory (AC-1..AC-8): classification of the 13 new setup kinds. The target is
// imported inside each test body so the file loads before the build; one `it` per AC.

type Classify = (path: string) => string | null;
type Rule = { kind: string; matches(path: string): boolean };

const NEW_KINDS = [
  "claude-rule",
  "aider-config",
  "conventions-md",
  "continue-rules",
  "roo-rules",
  "amazonq-rules",
  "junie-guidelines",
  "zed-rules",
  "augment-rules",
  "kiro-steering",
  "goosehints",
  "opencode-config",
  "gemini-settings",
] as const;

async function classifier(): Promise<Classify> {
  const mod = (await import("../src/setup/scan.js")) as unknown as { classifySetupPath: Classify };
  return mod.classifySetupPath;
}

function classifyAll(classify: Classify, paths: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(paths.map((p) => [p, classify(p)]));
}

/** Expected map: each matched path to its kind, each non-match to null. */
function expected(matched: Record<string, string>, none: readonly string[]): Record<string, string | null> {
  return { ...matched, ...Object.fromEntries(none.map((p) => [p, null])) };
}

async function expectClassified(matched: Record<string, string>, none: readonly string[]): Promise<void> {
  const classify = await classifier();
  const paths = [...Object.keys(matched), ...none];
  expect(classifyAll(classify, paths)).toEqual(expected(matched, none));
}

describe("agent setup classification (ai-agnostic-inventory)", () => {
  it("AC-1: classifies files under .claude/rules/ in any directory as claude-rule", async () => {
    await expectClassified(
      {
        ".claude/rules/style.md": "claude-rule",
        ".claude/rules/frontend/react.md": "claude-rule",
        "packages/web/.claude/rules/testing.md": "claude-rule",
      },
      [".claude/rules", ".claude/rulesx/a.md"],
    );
  });

  it("AC-2: classifies .aider.conf.yml and CONVENTIONS.md at the repo root only", async () => {
    await expectClassified(
      {
        ".aider.conf.yml": "aider-config",
        "CONVENTIONS.md": "conventions-md",
      },
      ["packages/x/.aider.conf.yml", "docs/CONVENTIONS.md", ".aider.conf.yaml", "conventions.md"],
    );
  });

  it("AC-3: classifies .continue/rules/ files and .continuerules at the repo root as continue-rules", async () => {
    await expectClassified(
      {
        ".continue/rules/style.md": "continue-rules",
        ".continue/rules/sub/x.md": "continue-rules",
        ".continuerules": "continue-rules",
      },
      [".continue/config.yaml", "packages/web/.continue/rules/x.md", "packages/web/.continuerules"],
    );
  });

  it("AC-4: classifies .roorules, .roorules-<mode>, .roo/rules/ and .roo/rules-<mode>/ at the root as roo-rules", async () => {
    await expectClassified(
      {
        ".roorules": "roo-rules",
        ".roorules-code": "roo-rules",
        ".roo/rules/style.md": "roo-rules",
        ".roo/rules/sub/x.md": "roo-rules",
        ".roo/rules-architect/plan.md": "roo-rules",
      },
      [".roorules-", ".roo/rules-/x.md", ".roo/other.md", "packages/web/.roorules", "packages/web/.roo/rules/x.md"],
    );
  });

  it("AC-5: classifies Amazon Q, Junie, Zed, Augment and Kiro files at the repo root only", async () => {
    await expectClassified(
      {
        ".amazonq/rules/a.md": "amazonq-rules",
        ".junie/guidelines.md": "junie-guidelines",
        ".rules": "zed-rules",
        ".augment/rules/a.md": "augment-rules",
        ".augment-guidelines": "augment-rules",
        ".kiro/steering/product.md": "kiro-steering",
      },
      [
        ".amazonq/other.json",
        "packages/web/.amazonq/rules/a.md",
        ".junie/other.md",
        "packages/web/.junie/guidelines.md",
        ".rules.bak",
        "packages/web/.rules",
        ".augment/other.json",
        ".kiro/specs/a.md",
        "packages/web/.kiro/steering/a.md",
      ],
    );
  });

  it("AC-6: classifies .goosehints in any directory, and OpenCode and Gemini settings at the root only", async () => {
    await expectClassified(
      {
        ".goosehints": "goosehints",
        "packages/web/.goosehints": "goosehints",
        "opencode.json": "opencode-config",
        "opencode.jsonc": "opencode-config",
        ".gemini/settings.json": "gemini-settings",
      },
      [
        ".goosehints.bak",
        "packages/web/opencode.json",
        ".opencode/agent/x.md",
        ".gemini/other.json",
        ".gemini/commands/x.toml",
        "packages/web/.gemini/settings.json",
      ],
    );
  });

  it("AC-7: lets the directory rule win over a file-name rule for the new kinds", async () => {
    await expectClassified(
      {
        ".claude/rules/CLAUDE.md": "claude-rule",
        "packages/web/.claude/rules/AGENTS.md": "claude-rule",
        ".kiro/steering/AGENTS.md": "kiro-steering",
        ".roo/rules/AGENTS.md": "roo-rules",
        ".continue/rules/AGENTS.md": "continue-rules",
        ".amazonq/rules/CLAUDE.md": "amazonq-rules",
      },
      [],
    );
  });

  it("AC-8: keeps every previous match and non-match in the rule table that now carries the 13 new kinds", async () => {
    const mod = (await import("../src/setup/scan.js")) as unknown as {
      classifySetupPath: Classify;
      SETUP_RULES: readonly Rule[];
    };

    // "After this change": the rule table carries every new kind.
    expect(Array.isArray(mod.SETUP_RULES)).toBe(true);
    const ruleKinds = new Set(mod.SETUP_RULES.map((rule) => rule.kind));
    expect(NEW_KINDS.filter((kind) => !ruleKinds.has(kind))).toEqual([]);

    // Every path packages/core/test/ac-setup-classify.test.ts and packages/core/test/scan.test.ts map to a kind.
    const previous: Record<string, string> = {
      // ac-setup-classify.test.ts AC-1
      "CLAUDE.local.md": "claude-local-md",
      "packages/web/CLAUDE.local.md": "claude-local-md",
      "GEMINI.md": "gemini-md",
      "packages/web/GEMINI.md": "gemini-md",
      // AC-2
      ".github/instructions/ts.instructions.md": "copilot-instructions-scoped",
      ".github/instructions/frontend/react.instructions.md": "copilot-instructions-scoped",
      ".github/agents/reviewer.agent.md": "copilot-agents",
      ".github/agents/notes/extra.md": "copilot-agents",
      ".github/prompts/release.prompt.md": "copilot-prompts",
      ".github/prompts/sub/x.md": "copilot-prompts",
      // AC-3
      ".cursor/mcp.json": "cursor-mcp",
      ".vscode/mcp.json": "vscode-mcp",
      ".codex/config.toml": "codex-config",
      ".windsurfrules": "windsurf-rules",
      ".windsurf/rules/style.md": "windsurf-rules",
      ".clinerules": "cline-rules",
      ".clinerules/style.md": "cline-rules",
      // AC-4
      "packages/web/.claude/skills/release/SKILL.md": "claude-skill",
      "packages/web/.claude/hooks/pre.sh": "claude-hook",
      "packages/web/.claude/agents/reviewer.md": "claude-agent",
      "packages/web/.claude/commands/ship.md": "claude-command",
      "packages/web/.cursor/rules/style.mdc": "cursor-rules",
      // AC-5 and scan.test.ts
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
      // AC-6
      ".github/agents/AGENTS.md": "copilot-agents",
      ".claude/agents/CLAUDE.md": "claude-agent",
      ".clinerules/AGENTS.md": "cline-rules",
      ".claude/skills/demo/AGENTS.md": "claude-skill",
      ".windsurf/rules/GEMINI.md": "windsurf-rules",
    };
    // Every path those two files expect to return no kind.
    const nonMatches = [
      // AC-4 and scan.test.ts: settings and .mcp.json count at the repo root only (F-10).
      "packages/web/.mcp.json",
      "packages/web/.claude/settings.json",
      "packages/web/.claude/settings.local.json",
      "src/.claude/settings.json",
      "nested/.mcp.json",
      // AC-6: a dot-file under a directory rule is a placeholder (F-10).
      ".claude/skills/demo/.mcp.json",
      ".github/instructions/notes.md",
      ".vscode/settings.json",
      ".codex/other.toml",
      ".windsurf/other.json",
      "packages/web/.cursor/mcp.json",
      "packages/web/.vscode/mcp.json",
      "gemini.md",
      "README.md",
      "claude.md",
      "docs/CLAUDE.md.bak",
      ".claude/settings.json.example",
      ".claude/skills",
      ".cursor/other.json",
    ];

    expect(classifyAll(mod.classifySetupPath, Object.keys(previous))).toEqual(previous);
    expect(classifyAll(mod.classifySetupPath, nonMatches)).toEqual(expected({}, nonMatches));
  });
});
