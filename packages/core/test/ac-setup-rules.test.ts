import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// AC test for agent-setup-inventory (AC-7). The target and the fixture are read inside the test body
// so the file loads before the build.

type Rule = { kind: string; matches(path: string): boolean };

const ALL_KINDS = [
  "agents-md",
  "claude-agent",
  "claude-command",
  "claude-hook",
  "claude-local-md",
  "claude-md",
  "claude-settings",
  "claude-settings-local",
  "claude-skill",
  "cline-rules",
  "codex-config",
  "copilot-agents",
  "copilot-instructions",
  "copilot-instructions-scoped",
  "copilot-prompts",
  "cursor-mcp",
  "cursor-rules",
  "gemini-md",
  "mcp-config",
  "vscode-mcp",
  "windsurf-rules",
];

describe("agent setup rule table (agent-setup-inventory)", () => {
  it("AC-7: matches every fixture path with exactly one rule and scans all 21 kinds", async () => {
    const mod = (await import("../src/setup/scan.js")) as unknown as {
      SETUP_RULES: readonly Rule[];
      scanAgentSetup(paths: readonly string[]): { files: { path: string; kind: string }[] };
    };
    const paths = fixture("setup/all-kinds.txt").trim().split("\n");
    expect(paths.length).toBeGreaterThanOrEqual(ALL_KINDS.length);

    // Each path is matched by exactly one rule.
    const matchCounts = Object.fromEntries(
      paths.map((p) => [p, mod.SETUP_RULES.filter((rule) => rule.matches(p)).length]),
    );
    expect(matchCounts).toEqual(Object.fromEntries(paths.map((p) => [p, 1])));

    // Every rule is reachable: it matches at least one fixture path.
    const unreachable = mod.SETUP_RULES.map((rule, i) => ({ i, kind: rule.kind })).filter(
      ({ i }) => !paths.some((p) => mod.SETUP_RULES[i]?.matches(p)),
    );
    expect(unreachable).toEqual([]);

    // The scan returns all 21 kinds, each at least once.
    const kinds = [...new Set(mod.scanAgentSetup(paths).files.map((f) => f.kind))].sort();
    expect(kinds).toEqual(ALL_KINDS);
    expect(kinds).toHaveLength(21);
  });
});
