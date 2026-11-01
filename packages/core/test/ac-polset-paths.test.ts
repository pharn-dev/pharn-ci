import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-3. The path predicates are loaded inside the test body: the AC test is written
// before the build adds them, so nothing the build adds may run while this file loads.

interface Paths {
  isPolicySettingsPath(path: string): boolean;
  isPolicyMcpPath(path: string): boolean;
  policySettingsPaths(repoFiles: readonly string[], document: unknown): string[];
}

const SETTINGS = [".claude/settings.json", ".claude/settings.local.json", "pkg/a/.claude/settings.json"];
const MCP = [".mcp.json", "pkg/.mcp.json", ".cursor/mcp.json", "pkg/.vscode/mcp.json"];
const NEITHER = [
  ".claude/settings.backup.json",
  ".claude/settings.json.bak",
  "x.claude/settings.json",
  ".cursor/mcp.jsonc",
  "mcp.json",
  "README.md",
];

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe("policy settings paths", () => {
  it("AC-3: exactly the settings and MCP paths of the two regexes are selected, MCP paths only when an MCP list is non-empty, sorted in code-unit order", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Paths;
    for (const name of ["isPolicySettingsPath", "isPolicyMcpPath", "policySettingsPaths"] as const) {
      expect(typeof core[name], `${name} is exported`).toBe("function");
    }

    for (const path of SETTINGS) {
      expect(core.isPolicySettingsPath(path), `${path} is a settings path`).toBe(true);
      expect(core.isPolicyMcpPath(path), `${path} is not an MCP path`).toBe(false);
    }
    for (const path of MCP) {
      expect(core.isPolicyMcpPath(path), `${path} is an MCP path`).toBe(true);
      expect(core.isPolicySettingsPath(path), `${path} is not a settings path`).toBe(false);
    }
    for (const path of NEITHER) {
      expect(core.isPolicySettingsPath(path), `${path} is not a settings path`).toBe(false);
      expect(core.isPolicyMcpPath(path), `${path} is not an MCP path`).toBe(false);
    }

    // Shuffled, with a duplicate: the result is distinct and sorted.
    const repoFiles = [...NEITHER, MCP[2], SETTINGS[2], MCP[0], SETTINGS[1], MCP[3], SETTINGS[0], MCP[1], SETTINGS[0]];
    const settingsOnly = [...SETTINGS].sort(byCodeUnit);
    const both = [...SETTINGS, ...MCP].sort(byCodeUnit);
    expect(settingsOnly).toEqual([
      ".claude/settings.json",
      ".claude/settings.local.json",
      "pkg/a/.claude/settings.json",
    ]);

    for (const document of [
      { version: 1 },
      { version: 1, setup: {} },
      { version: 1, setup: { allowed_mcp_servers: [], forbidden_mcp_servers: [], forbidden_permissions: ["Bash"] } },
    ]) {
      expect(core.policySettingsPaths(repoFiles as string[], document), JSON.stringify(document)).toEqual(settingsOnly);
    }
    for (const document of [
      { version: 1, setup: { allowed_mcp_servers: ["github"] } },
      { version: 1, setup: { forbidden_mcp_servers: ["evil"] } },
      { version: 1, setup: { allowed_mcp_servers: [], forbidden_mcp_servers: ["evil"] } },
    ]) {
      expect(core.policySettingsPaths(repoFiles as string[], document), JSON.stringify(document)).toEqual(both);
    }
    expect(core.policySettingsPaths([], { version: 1, setup: { allowed_mcp_servers: ["github"] } })).toEqual([]);
  });
});
