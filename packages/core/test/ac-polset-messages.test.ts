import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-17. check(), evaluatePolicyRules() and renderMarkdown() are loaded inside the test
// body: the AC test is written before the build adds the settings rules, so nothing the build adds may run while this
// file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
interface Core {
  check(input: unknown): Report;
  evaluatePolicyRules(input: unknown): { violations: Violation[]; omitted: Record<string, number>; lowered: string[] };
  renderMarkdown(report: unknown): string;
}

const REPO_ROOT = "/home/runner/work/demo/demo";
const FILE = (document: unknown) => ({ source: "file", version: null, path: "policy/org.json", document });
const sourcesOf = (files: Record<string, string>) => ({
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
  dropped: [],
});

async function run(document: unknown, files: Record<string, string>): Promise<Report> {
  const core = (await import("@pharn-ci/core")) as unknown as Core;
  const report = core.check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ...Object.keys(files)],
    policy: FILE(document),
    policySettingsSources: sourcesOf(files),
  });
  expectValidReport(report);
  return report;
}

const messageOf = (report: Report, code: string): Message => {
  const found = report.messages.filter((m) => m.code === code);
  expect(found, code).toHaveLength(1);
  return found[0] as Message;
};

const S = "`.claude/settings.json`";
const M = "`.mcp.json`";
const allowFile = (rules: string[]) =>
  `{\n  "permissions": {\n    "allow": [\n${rules.map((r) => `      ${JSON.stringify(r)}`).join(",\n")}\n    ]\n  }\n}\n`;
const mcpFile = (names: string[]) =>
  `{\n  "mcpServers": {\n${names.map((n) => `    ${JSON.stringify(n)}: { "command": "node" }`).join(",\n")}\n  }\n}\n`;

const P02_TAIL =
  ". Each is an allow rule equal to, broader than or inside a permission the org policy forbids, a defaultMode of bypassPermissions or auto, or additionalDirectories.";
const SETTINGS_HEAD = "P02–P06 could not fully use these agent settings files: ";
const SETTINGS_TAIL =
  ". Claude Code skips an unparseable file or entry; pharn-ci never guesses what it meant, and a file it could not read counts against the policy.";

const HINTS: Record<string, string> = {
  POLICY_P02:
    "Narrow or remove the allow rule (or the defaultMode or additionalDirectories key) in the settings file, or ask the policy owner to change setup.forbidden_permissions.",
  POLICY_P03:
    "Add a deny rule equal to or broader than the required one to the .claude/settings.json of each directory named.",
  POLICY_P04: "Remove the server, or ask the policy owner to add it to setup.allowed_mcp_servers.",
  POLICY_P05: "Remove the server from the MCP file.",
  POLICY_P06:
    "Add a command hook for the event whose matcher covers the required one (`*` or the same tool names), without an if condition.",
  POLICY_SETTINGS_INVALID:
    "Keep agent settings files valid JSON and regular files under 512 KiB, and run on a checkout of the pull request head, so the org policy can check them.",
};

describe("the P02–P06 and POLICY_SETTINGS_INVALID messages", { timeout: 60_000 }, () => {
  it("AC-17: each template with singular and plural, {locs} capped at 20 with the cap's omissions counted, 50 violations kept per rule, the strongest level, 20 problems then and N more, and the six hints", async () => {
    const forbid = { version: 1, setup: { forbidden_permissions: ["Bash(curl:*)"] } };

    // P02: allow entries start on line 4.
    expect(
      messageOf(await run(forbid, { ".claude/settings.json": allowFile(["Bash(curl:*)"]) }), "POLICY_P02"),
    ).toEqual({
      level: "error",
      code: "POLICY_P02",
      text: `P02 forbidden permission allowed: 1 finding at ${S} line 4${P02_TAIL}`,
    });
    const p02Two = messageOf(
      await run(forbid, { ".claude/settings.json": allowFile(["Bash(curl:*)", "Bash(curl x)"]) }),
      "POLICY_P02",
    );
    expect(p02Two.text).toBe(`P02 forbidden permission allowed: 2 findings at ${S} line 4, ${S} line 5${P02_TAIL}`);
    const warnOnly = messageOf(
      await run(
        { version: 1 },
        { ".claude/settings.json": '{\n  "permissions": { "additionalDirectories": ["../x"] }\n}\n' },
      ),
      "POLICY_P02",
    );
    expect([warnOnly.level, warnOnly.text]).toEqual([
      "warn",
      `P02 forbidden permission allowed: 1 finding at ${S} line 2${P02_TAIL}`,
    ]);

    // P03: both missing rules sit at the same location, so it is named once.
    const P03_TAIL = ". A deny rule counts when it is equal to or broader than the required one.";
    expect(
      messageOf(await run({ version: 1, setup: { required_permissions_deny: ["Bash(rm -rf:*)"] } }, {}), "POLICY_P03"),
    ).toEqual({
      level: "error",
      code: "POLICY_P03",
      text: `P03 required deny missing: 1 required deny rule not covered by a deny rule at ${S}${P03_TAIL}`,
    });
    expect(
      messageOf(
        await run({ version: 1, setup: { required_permissions_deny: ["Bash(rm -rf:*)", "Read(.env)"] } }, {}),
        "POLICY_P03",
      ).text,
    ).toBe(`P03 required deny missing: 2 required deny rules not covered by a deny rule at ${S}${P03_TAIL}`);

    // P04 and P05: servers start on line 3.
    const P04_TAIL = " not on the org policy's allowlist, or enableAllProjectMcpServers set while the policy has one.";
    const allowed = { version: 1, setup: { allowed_mcp_servers: ["github"] } };
    expect(messageOf(await run(allowed, { ".mcp.json": mcpFile(["notes"]) }), "POLICY_P04")).toEqual({
      level: "error",
      code: "POLICY_P04",
      text: `P04 MCP server not allowlisted: 1 MCP server at ${M} line 3${P04_TAIL}`,
    });
    expect(messageOf(await run(allowed, { ".mcp.json": mcpFile(["notes", "tasks"]) }), "POLICY_P04").text).toBe(
      `P04 MCP server not allowlisted: 2 MCP servers at ${M} line 3, ${M} line 4${P04_TAIL}`,
    );
    const forbiddenMcp = { version: 1, setup: { forbidden_mcp_servers: ["evil*"] } };
    expect(messageOf(await run(forbiddenMcp, { ".mcp.json": mcpFile(["evil"]) }), "POLICY_P05")).toEqual({
      level: "error",
      code: "POLICY_P05",
      text: `P05 forbidden MCP server: 1 MCP server at ${M} line 3 matches an entry the org policy forbids, by name, command or URL.`,
    });
    expect(messageOf(await run(forbiddenMcp, { ".mcp.json": mcpFile(["evil1", "evil2"]) }), "POLICY_P05").text).toBe(
      `P05 forbidden MCP server: 2 MCP servers at ${M} line 3, ${M} line 4 match an entry the org policy forbids, by name, command or URL.`,
    );

    // P06.
    const P06_TAIL =
      ", or disableAllHooks set while the policy requires hooks. Only a command hook with no if condition, whose matcher covers the required one, counts.";
    expect(
      messageOf(await run({ version: 1, setup: { required_hooks: [{ event: "Stop" }] } }, {}), "POLICY_P06"),
    ).toEqual({
      level: "error",
      code: "POLICY_P06",
      text: `P06 required hook missing: 1 required hook missing at ${S}${P06_TAIL}`,
    });
    expect(
      messageOf(
        await run(
          { version: 1, setup: { required_hooks: [{ event: "Stop" }, { event: "PreToolUse", matcher: "Bash" }] } },
          {},
        ),
        "POLICY_P06",
      ).text,
    ).toBe(`P06 required hook missing: 2 required hooks missing at ${S}${P06_TAIL}`);

    // 60 P02 violations at 60 lines: 50 kept, 10 omitted, 20 locations named, then the 30 kept and 10 omitted counted.
    const sixty = Array.from({ length: 60 }, (_, i) => `Bash(curl n${i})`);
    const files = { ".claude/settings.json": allowFile(sixty) };
    const big = await run(forbid, files);
    const kept = (big.policy?.violations ?? []).filter((v) => v.id === "P02");
    expect(kept).toHaveLength(50);
    expect(kept.map((v) => v.line)).toEqual(Array.from({ length: 50 }, (_, i) => i + 4));
    const locs = Array.from({ length: 20 }, (_, i) => `${S} line ${i + 4}`).join(", ");
    expect(messageOf(big, "POLICY_P02").text).toBe(
      `P02 forbidden permission allowed: 60 findings at ${locs} and 40 more${P02_TAIL}`,
    );
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const evaluation = core.evaluatePolicyRules({
      policy: FILE(forbid),
      agentSetupFileCount: 1,
      agentTools: [],
      repoFiles: ["AGENTS.md", ".claude/settings.json"],
      diff: [],
      configPath: null,
      ignored: [],
      settingsSources: sourcesOf(files),
    });
    expect(evaluation.violations.filter((v) => v.id === "P02")).toHaveLength(50);
    expect(evaluation.omitted.P02).toBe(10);

    // 25 problems: 20 named, then and 5 more.
    const unknown = Array.from({ length: 25 }, () => "Bash(a:*b)");
    const problems = messageOf(
      await run({ version: 1 }, { ".claude/settings.json": allowFile(unknown) }),
      "POLICY_SETTINGS_INVALID",
    );
    const named = Array.from({ length: 20 }, (_, i) => `${S} line ${i + 4} (\`unknown-rule-syntax\`)`).join(", ");
    expect([problems.level, problems.text]).toEqual(["warn", `${SETTINGS_HEAD}${named} and 5 more${SETTINGS_TAIL}`]);

    // The six hints: under each violation in the Policy section, and under the Settings line.
    const base = core.check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    const violation = (id: string): Violation => ({
      id,
      severity: "block",
      path: ".claude/settings.json",
      line: 3,
      detail: "x",
    });
    const markdown = core.renderMarkdown({
      ...base,
      policy: { source: "input", version: null, violations: ["P02", "P03", "P04", "P05", "P06"].map(violation) },
      messages: [
        ...base.messages,
        {
          level: "warn",
          code: "POLICY_SETTINGS_INVALID",
          text: `${SETTINGS_HEAD}${S} line 6 (\`not-json\`)${SETTINGS_TAIL}`,
        },
      ],
    });
    for (const [code, hint] of Object.entries(HINTS)) {
      expect(markdown, `the ${code} hint`).toContain(`  - Hint: ${hint}\n`);
    }
    const source = readFileSync(new URL("../src/render/markdown.ts", import.meta.url), "utf8");
    const table = source.slice(source.indexOf("MESSAGE_HINTS"));
    for (const code of Object.keys(HINTS))
      expect(table, `MESSAGE_HINTS has ${code}`).toMatch(new RegExp(`\\b${code}\\s*:`));
  });
});
