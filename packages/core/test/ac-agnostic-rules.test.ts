import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// AC test for ai-agnostic-inventory (AC-9): rule reachability and overlap over the per-kind fixture. The target
// is imported inside the test body so the file loads before the build.

type Rule = { kind: string; matches(path: string): boolean };
type Inventory = { files: { path: string; kind: string }[] };

// The 21 kinds that existed before this change plus the 13 it adds, sorted.
const ALL_KINDS = [
  "agents-md",
  "aider-config",
  "amazonq-rules",
  "augment-rules",
  "claude-agent",
  "claude-command",
  "claude-hook",
  "claude-local-md",
  "claude-md",
  "claude-rule",
  "claude-settings",
  "claude-settings-local",
  "claude-skill",
  "cline-rules",
  "codex-config",
  "continue-rules",
  "conventions-md",
  "copilot-agents",
  "copilot-instructions",
  "copilot-instructions-scoped",
  "copilot-prompts",
  "cursor-mcp",
  "cursor-rules",
  "gemini-md",
  "gemini-settings",
  "goosehints",
  "junie-guidelines",
  "kiro-steering",
  "mcp-config",
  "opencode-config",
  "roo-rules",
  "vscode-mcp",
  "windsurf-rules",
  "zed-rules",
];

describe("agent setup rules over the per-kind fixture (ai-agnostic-inventory)", () => {
  it("AC-9: each fixture path matches exactly one rule, every rule is reachable, and the scan finds all 34 kinds", async () => {
    const { SETUP_RULES, scanAgentSetup } = (await import("../src/setup/scan.js")) as unknown as {
      SETUP_RULES: readonly Rule[];
      scanAgentSetup: (paths: readonly string[]) => Inventory;
    };
    const paths = fixture("setup/all-kinds.txt")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(ALL_KINDS).toHaveLength(34);

    // Each path is matched by exactly one rule.
    const ruleCount = Object.fromEntries(paths.map((p) => [p, SETUP_RULES.filter((rule) => rule.matches(p)).length]));
    expect(ruleCount).toEqual(Object.fromEntries(paths.map((p) => [p, 1])));

    // Every rule matches at least one path.
    const unreachable = SETUP_RULES.map((rule, index) => ({ index, kind: rule.kind, rule })).filter(
      ({ rule }) => !paths.some((p) => rule.matches(p)),
    );
    expect(unreachable.map(({ index, kind }) => `${index}:${kind}`)).toEqual([]);

    // The scan returns all 34 kinds, each at least once.
    const { files } = scanAgentSetup(paths);
    expect([...new Set(files.map((file) => file.kind))].sort()).toEqual(ALL_KINDS);
  });
});
