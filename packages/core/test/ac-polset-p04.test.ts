import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-10. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

async function p04Of(document: unknown, files: Record<string, string>): Promise<Violation[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ...Object.keys(files)],
    policy: { source: "file", version: null, path: "policy/org.json", document },
    policySettingsSources: { files: Object.entries(files).map(([path, text]) => ({ path, text })), dropped: [] },
  } as never);
  expectValidReport(report);
  return ((report as unknown as Report).policy?.violations ?? []).filter((v) => v.id === "P04");
}

function doc(lines: string[]) {
  return {
    text: `${lines.join("\n")}\n`,
    at(needle: string): number {
      const i = lines.findIndex((l) => l.includes(needle));
      if (i === -1) throw new Error(`no line holds ${needle}`);
      return i + 1;
    },
  };
}

const NOT_LISTED = "MCP server is not on the policy's allowlist";

describe("org policy rule P04: MCP server not allowlisted", { timeout: 60_000 }, () => {
  it("AC-10: each unlisted server key and enabledMcpjsonServers name is a P04 block at its line, disabledMcpjsonServers removes nothing, enableAllProjectMcpServers is a block, a listed server and an empty allowlist give none", async () => {
    const mcp = doc([
      "{",
      '  "mcpServers": {',
      '    "notes": { "command": "node", "args": ["notes.js"] },',
      '    "github": { "command": "node", "args": ["github.js"] }',
      "  }",
      "}",
    ]);
    const cursor = doc([
      "{",
      "  // a comment, then a trailing comma: JSONC",
      '  "mcpServers": {',
      '    "cursorx": { "command": "node" },',
      "  },",
      "}",
    ]);
    const vscode = doc([
      "{",
      '  "servers": {',
      '    "vsa": { "command": "node" }',
      "  },",
      '  "mcpServers": {',
      '    "vsb": { "command": "node" }',
      "  }",
      "}",
    ]);
    const settings = doc([
      "{",
      '  "enabledMcpjsonServers": [',
      '    "enabledx",',
      '    "github"',
      "  ],",
      '  "disabledMcpjsonServers": ["enabledx", "notes"],',
      '  "enableAllProjectMcpServers": true',
      "}",
    ]);
    const files = {
      ".claude/settings.json": settings.text,
      ".cursor/mcp.json": cursor.text,
      ".mcp.json": mcp.text,
      ".vscode/mcp.json": vscode.text,
    };
    const block = (path: string, line: number, detail = NOT_LISTED): Violation => ({
      id: "P04",
      severity: "block",
      path,
      line,
      detail,
    });

    const listed = await p04Of({ version: 1, setup: { allowed_mcp_servers: ["github"] } }, files);
    expect(listed).toEqual([
      block(".claude/settings.json", settings.at('"enabledx",')),
      block(
        ".claude/settings.json",
        settings.at("enableAllProjectMcpServers"),
        "enableAllProjectMcpServers approves every project MCP server",
      ),
      block(".cursor/mcp.json", cursor.at('"cursorx"')),
      block(".mcp.json", mcp.at('"notes"')),
      block(".vscode/mcp.json", vscode.at('"vsa"')),
      block(".vscode/mcp.json", vscode.at('"vsb"')),
    ]);
    expect(
      listed.some((v) => v.path === ".mcp.json" && v.line === mcp.at('"github"')),
      "github is listed",
    ).toBe(false);

    expect(await p04Of({ version: 1, setup: { allowed_mcp_servers: [] } }, files), "an empty allowlist").toEqual([]);
  });
});
