import { describe, expect, it } from "vitest";

// settings-unparseable-fails-closed (review A3-F2), AC-1. An agent settings or MCP file pharn-ci could not parse is an
// error whatever the policy lists. The target is loaded inside the test body, the test-first convention.

type Problem = {
  path: string | null;
  line: number | null;
  reason: string;
  readers: string[];
  problemClass: string;
};

const ALL = ["P02", "P03", "P04", "P05", "P06"];
const MCP = ["P04", "P05"];

const SETUPS: Record<string, Record<string, unknown> | undefined> = {
  none: undefined,
  "forbidden_permissions only": { forbidden_permissions: ["Bash(*)"] },
  required_permissions_deny: { required_permissions_deny: ["Bash(rm -rf:*)"] },
  required_hooks: { required_hooks: [{ event: "PreToolUse" }] },
  "allowed_mcp_servers only": { allowed_mcp_servers: ["ok"] },
  "forbidden_mcp_servers only": { forbidden_mcp_servers: ["evil"] },
};

const problem = (problemClass: string, reason: string, path: string, readers: string[]): Problem => ({
  path,
  line: problemClass === "drop" || problemClass.startsWith("unparseable") ? null : 1,
  reason,
  readers,
  problemClass,
});

describe("settingsProblemLevel: unparseable settings and MCP files fail closed", () => {
  it("AC-1: unparseable-settings and unparseable-mcp are errors under every setup; the other classes keep their levels", async () => {
    const { settingsProblemLevel } = await import("../src/policy/rules/problems.js");
    const level = (p: Problem, setup: Record<string, unknown> | undefined) =>
      settingsProblemLevel(p as never, setup as never);

    const unparseable = [
      problem("unparseable-settings", "too-deep", ".claude/settings.json", ALL),
      problem("unparseable-settings", "not-json", ".claude/settings.json", ALL),
      problem("unparseable-settings", "not-object", ".claude/settings.local.json", ALL),
      problem("unparseable-settings", "binary", ".claude/settings.json", ALL),
      problem("unparseable-mcp", "too-deep", ".mcp.json", MCP),
      problem("unparseable-mcp", "not-json", ".cursor/mcp.json", MCP),
      problem("unparseable-mcp", "not-object", ".vscode/mcp.json", MCP),
      problem("unparseable-mcp", "binary", ".mcp.json", MCP),
    ];
    const drop = problem("drop", "too-large", ".claude/settings.json", ALL);
    const deny = problem("deny", "wrong-type", ".claude/settings.json", ["P03"]);
    const hooks = problem("hooks", "wrong-type", ".claude/settings.json", ["P06"]);
    const allowSyntax = problem("allow-syntax", "unknown-rule-syntax", ".claude/settings.json", ["P02"]);
    const duplicate = problem("other", "duplicate-key", ".claude/settings.json", ALL);

    const got: Record<string, string[]> = {};
    const want: Record<string, string[]> = {};
    for (const [name, setup] of Object.entries(SETUPS)) {
      got[name] = [
        ...unparseable.map((p) => level(p, setup)),
        level(drop, setup),
        level(deny, setup),
        level(hooks, setup),
        level(allowSyntax, setup),
        level(duplicate, setup),
      ];
      want[name] = [
        ...unparseable.map(() => "error"),
        "error",
        name === "required_permissions_deny" ? "error" : "warn",
        name === "required_hooks" ? "error" : "warn",
        "warn",
        "warn",
      ];
    }
    expect(got).toEqual(want);
  });
});
