import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-11. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

async function run(document: unknown, files: Record<string, string>): Promise<Report> {
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
  return report as unknown as Report;
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

const PREFIX = "MCP server matches forbidden entry ";

describe("org policy rule P05: forbidden MCP server", { timeout: 60_000 }, () => {
  it("AC-11: a server matching by key, command, command line or url is one P05 block at its key's line naming the first entry, env and headers are never read, a string-valued server counts by name, and an enabledMcpjsonServers name matches by name", async () => {
    const document = {
      version: 1,
      setup: { forbidden_mcp_servers: ["evil", "*/curl", "npx -y bad*", "https://bad.example/*"] },
    };
    const mcp = doc([
      "{",
      '  "mcpServers": {',
      '    "evil": { "command": "npx", "args": ["-y", "badthing"], "url": "https://bad.example/a" },',
      '    "fetcher": { "command": "/usr/bin/curl" },',
      '    "runner": { "command": "npx", "args": ["-y", "badpkg"] },',
      '    "remote": { "url": "https://bad.example/mcp" },',
      '    "envonly": { "command": "node", "env": { "TOOL": "/usr/bin/curl" }, "headers": { "X-Link": "https://bad.example/h" } },',
      '    "plain": { "command": "node", "args": ["server.js"] },',
      '    "x/curl": "npx -y badstr"',
      "  }",
      "}",
    ]);
    const nested = doc(["{", '  "mcpServers": {', '    "evil": { "command": "node" }', "  }", "}"]);
    const settings = doc(["{", '  "enabledMcpjsonServers": [', '    "evil",', '    "plain"', "  ]", "}"]);
    const report = await run(document, {
      ".claude/settings.json": settings.text,
      ".mcp.json": mcp.text,
      "pkg/.mcp.json": nested.text,
    });

    const block = (path: string, line: number, entry: string): Violation => ({
      id: "P05",
      severity: "block",
      path,
      line,
      detail: PREFIX + entry,
    });
    const p05 = (report.policy?.violations ?? []).filter((v) => v.id === "P05");
    expect(p05).toEqual([
      block(".claude/settings.json", settings.at('"evil",'), "evil"),
      block(".mcp.json", mcp.at('"evil"'), "evil and 2 more"),
      block(".mcp.json", mcp.at('"fetcher"'), "*/curl"),
      block(".mcp.json", mcp.at('"runner"'), "npx -y bad*"),
      block(".mcp.json", mcp.at('"remote"'), "https://bad.example/*"),
      block(".mcp.json", mcp.at('"x/curl"'), "*/curl"),
      block("pkg/.mcp.json", nested.at('"evil"'), "evil"),
    ]);
    for (const quiet of ['"envonly"', '"plain"']) {
      expect(
        p05.some((v) => v.path === ".mcp.json" && v.line === mcp.at(quiet)),
        `no P05 at ${quiet}`,
      ).toBe(false);
    }

    // The string-valued server is also a wrong-type problem at its line.
    const invalid = report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.text).toContain(`\`.mcp.json\` line ${mcp.at('"x/curl"')} (\`wrong-type\`)`);
  });
});
