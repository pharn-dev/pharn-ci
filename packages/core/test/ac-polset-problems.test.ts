import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-13. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[] };
type Problem = { path: string | null; line: number | null; reason: string };
type Drop = { path: string; reason: string };

const REPO_ROOT = "/home/runner/work/demo/demo";
const FULL = {
  version: 1,
  setup: {
    forbidden_permissions: ["Bash(curl:*)"],
    required_permissions_deny: ["Bash(rm -rf:*)"],
    allowed_mcp_servers: ["github"],
    forbidden_mcp_servers: ["evil"],
    required_hooks: [{ event: "Stop" }],
  },
};
const P02_ONLY = { version: 1, setup: { forbidden_permissions: ["Bash(curl:*)"] } };

async function invalidOf(document: unknown, files: Record<string, string>, dropped: Drop[] = []): Promise<Message[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ...Object.keys(files), ...dropped.map((d) => d.path)],
    policy: { source: "file", version: null, path: "policy/org.json", document },
    policySettingsSources: { files: Object.entries(files).map(([path, text]) => ({ path, text })), dropped },
  } as never);
  expectValidReport(report);
  return (report as unknown as Report).messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID");
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byProblem = (a: Problem, b: Problem) =>
  (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : cmp(a.path, b.path)) ||
  (a.line === b.line ? 0 : a.line === null ? -1 : b.line === null ? 1 : a.line - b.line) ||
  cmp(a.reason, b.reason);
const item = (p: Problem) =>
  p.path === null
    ? `the rule comparison (\`${p.reason}\`)`
    : `\`${p.path}\`${p.line === null ? "" : ` line ${p.line}`} (\`${p.reason}\`)`;
/** The binding POLICY_SETTINGS_INVALID text for these problems (at most 20 here). */
const textOf = (problems: Problem[]) =>
  `P02–P06 could not fully use these agent settings files: ${[...problems].sort(byProblem).map(item).join(", ")}. Claude Code skips an unparseable file or entry; pharn-ci never guesses what it meant, and a file it could not read counts against the policy.`;

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

const TOO_DEEP = `{ "a": ${"[".repeat(70)}${"]".repeat(70)} }\n`;
const DROPS: Drop[] = [
  { path: "big/.claude/settings.json", reason: "too-large" },
  { path: "cap/.claude/settings.json", reason: "over-file-cap" },
  { path: "total/.claude/settings.json", reason: "over-total-cap" },
  { path: "weird/../.claude/settings.json", reason: "unsafe-path" },
  { path: "link/.claude/settings.json", reason: "symlink" },
  { path: "gone/.claude/settings.json", reason: "missing" },
];
const SETTINGS_BINARY: Drop = { path: "bin/.claude/settings.json", reason: "binary" };
const MCP_BINARY: Drop = { path: "mbin/.mcp.json", reason: "binary" };
const UNPARSEABLE_SETTINGS = {
  "nj/.claude/settings.json": '{ "a": }\n',
  "no/.claude/settings.json": "[1, 2]\n",
  "deep/.claude/settings.json": TOO_DEEP,
};
const UNPARSEABLE_MCP = {
  "mnj/.mcp.json": '{ "mcpServers": }\n',
  "mno/.mcp.json": "[]\n",
  "mdeep/.mcp.json": TOO_DEEP,
};
const fileLevel = (paths: Record<string, string>, reasons: string[]): Problem[] =>
  Object.keys(paths).map((path, i) => ({ path, line: null, reason: reasons[i] as string }));
const SETTINGS_FILE_PROBLEMS: Problem[] = [
  ...fileLevel(UNPARSEABLE_SETTINGS, ["not-json", "not-object", "too-deep"]),
  { path: SETTINGS_BINARY.path, line: null, reason: "binary" },
];
const MCP_FILE_PROBLEMS: Problem[] = [
  ...fileLevel(UNPARSEABLE_MCP, ["not-json", "not-object", "too-deep"]),
  { path: MCP_BINARY.path, line: null, reason: "binary" },
];
const DROP_PROBLEMS: Problem[] = DROPS.filter((d) => d.reason !== "missing").map((d) => ({ ...d, line: null }));

describe("POLICY_SETTINGS_INVALID: the problem table", { timeout: 60_000 }, () => {
  it("AC-13: one message lists each problem as path, line and reason in sort order, at the strongest level of the table; a missing drop and a problem no rule in force reads are not listed", async () => {
    // Drops and unparseable files, every list set: drops and unparseable settings files are errors, MCP files warn.
    const full = await invalidOf({ ...FULL }, { ...UNPARSEABLE_SETTINGS, ...UNPARSEABLE_MCP }, [
      ...DROPS,
      SETTINGS_BINARY,
      MCP_BINARY,
    ]);
    expect(full).toHaveLength(1);
    expect(full[0]?.text).toBe(textOf([...DROP_PROBLEMS, ...SETTINGS_FILE_PROBLEMS, ...MCP_FILE_PROBLEMS]));
    expect(full[0]?.level).toBe("error");
    expect(full[0]?.text.includes("gone/"), "a missing drop gives no problem").toBe(false);

    // Only P02 in force: the MCP files are not read, so they are not listed; the drops are still errors.
    const p02Only = await invalidOf(P02_ONLY, { ...UNPARSEABLE_SETTINGS, ...UNPARSEABLE_MCP }, [
      ...DROPS,
      SETTINGS_BINARY,
      MCP_BINARY,
    ]);
    expect(p02Only.map((m) => [m.level, m.text])).toEqual([
      ["error", textOf([...DROP_PROBLEMS, ...SETTINGS_FILE_PROBLEMS])],
    ]);

    // Unparseable settings files without a required list are warnings.
    const settingsWarn = await invalidOf(P02_ONLY, UNPARSEABLE_SETTINGS, [SETTINGS_BINARY]);
    expect(settingsWarn.map((m) => [m.level, m.text])).toEqual([["warn", textOf(SETTINGS_FILE_PROBLEMS)]]);
    const settingsError = await invalidOf(
      { version: 1, setup: { required_hooks: [{ event: "Stop" }] } },
      UNPARSEABLE_SETTINGS,
      [SETTINGS_BINARY],
    );
    expect(settingsError.map((m) => [m.level, m.text])).toEqual([["error", textOf(SETTINGS_FILE_PROBLEMS)]]);

    // An unparseable MCP file is a warning.
    const mcpWarn = await invalidOf({ version: 1, setup: { allowed_mcp_servers: ["github"] } }, UNPARSEABLE_MCP, [
      MCP_BINARY,
    ]);
    expect(mcpWarn.map((m) => [m.level, m.text])).toEqual([["warn", textOf(MCP_FILE_PROBLEMS)]]);

    // Entries: unknown syntax, wrong types and a duplicate key.
    const settings = doc([
      "{",
      '  "permissions": {',
      '    "allow": [',
      '      "Bash(a:*b)",',
      "      42",
      "    ],",
      '    "deny": [',
      '      "Read([ab].env)",',
      "      7",
      "    ],",
      '    "defaultMode": 3,',
      '    "additionalDirectories": "../x"',
      "  },",
      '  "enableAllProjectMcpServers": "yes",',
      '  "enabledMcpjsonServers": "notes",',
      '  "hooks": [],',
      '  "disableAllHooks": "no",',
      '  "model": "a",',
      '  "model": "b"',
      "}",
    ]);
    const mcp = doc(["{", '  "mcpServers": {', '    "github": "text"', "  }", "}"]);
    const S = ".claude/settings.json";
    const p = (needle: string, reason: string, path = S, d = settings): Problem => ({
      path,
      line: d.at(needle),
      reason,
    });
    const P02_READ = [
      p('"Bash(a:*b)"', "unknown-rule-syntax"),
      p("      42", "wrong-type"),
      p('"defaultMode"', "wrong-type"),
      p('"additionalDirectories"', "wrong-type"),
      p('"model": "b"', "duplicate-key"),
    ];
    const OTHERS = [
      p('"Read([ab].env)"', "unknown-rule-syntax"),
      p("      7", "wrong-type"),
      p('"enableAllProjectMcpServers"', "wrong-type"),
      p('"enabledMcpjsonServers"', "wrong-type"),
      p('"hooks"', "wrong-type"),
      p('"disableAllHooks"', "wrong-type"),
      p('"github"', "wrong-type", ".mcp.json", mcp),
    ];
    const files = { [S]: settings.text, ".mcp.json": mcp.text };

    const entries = await invalidOf(FULL, files);
    expect(entries.map((m) => [m.level, m.text])).toEqual([["error", textOf([...P02_READ, ...OTHERS])]]);

    // With no required deny rule, hook or MCP list, only what P02 reads is listed, and every one of them warns.
    const p02Entries = await invalidOf({ version: 1 }, files);
    expect(p02Entries.map((m) => [m.level, m.text])).toEqual([["warn", textOf(P02_READ)]]);

    // Deny problems are errors only when a required deny list is set; on their own they are listed at that level.
    const denyOnly = doc([
      "{",
      '  "permissions": {',
      '    "deny": [',
      '      "Read([ab].env)",',
      "      7",
      "    ]",
      "  }",
      "}",
    ]);
    const denyRun = await invalidOf(
      { version: 1, setup: { required_permissions_deny: ["Read(.env)"] } },
      {
        [S]: denyOnly.text,
      },
    );
    expect(denyRun.map((m) => [m.level, m.text])).toEqual([
      [
        "error",
        textOf([p('"Read([ab].env)"', "unknown-rule-syntax", S, denyOnly), p("      7", "wrong-type", S, denyOnly)]),
      ],
    ]);
    expect(await invalidOf({ version: 1 }, { [S]: denyOnly.text }), "no rule reads deny without the list").toEqual([]);
  });
});
