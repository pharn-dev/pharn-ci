import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-18. check() and evaluatePolicyRules() are loaded inside the test body: the AC test
// is written before the build adds the settings rules, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
interface Core {
  check(input: unknown): Report;
  evaluatePolicyRules(input: unknown): { violations: Violation[]; omitted: Record<string, number>; lowered: string[] };
}

const REPO_ROOT = "/home/runner/work/demo/demo";
const LINES = [
  "{",
  '  "permissions": {',
  '    "allow": [',
  '      "Bash(curl:*)",',
  '      "Bash(a:*b)"',
  "    ],",
  '    "defaultMode": "bypassPermissions",',
  '    "additionalDirectories": ["../shared"]',
  "  }",
  "}",
];
const at = (needle: string) => LINES.findIndex((l) => l.includes(needle)) + 1;
const SOURCES = { files: [{ path: ".claude/settings.json", text: `${LINES.join("\n")}\n` }], dropped: [] };
const documentWith = (P02: string) => ({
  version: 1,
  setup: { forbidden_permissions: ["Bash(curl:*)"] },
  policy: { rules: { P02 } },
});
const app = (P02: string) => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document: documentWith(P02),
});
const file = (P02: string) => ({ source: "file", version: null, path: "policy/org.json", document: documentWith(P02) });

async function run(policy: unknown): Promise<Report> {
  const core = (await import("@pharn-ci/core")) as unknown as Core;
  const report = core.check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ".claude/settings.json"],
    policy,
    policySettingsSources: SOURCES,
  });
  expectValidReport(report);
  return report;
}

const p02 = (report: Report) =>
  (report.policy?.violations ?? []).filter((v) => v.id === "P02").map((v) => [v.line, v.severity]);
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P02: severity from policy.rules", { timeout: 60_000 }, () => {
  it("AC-18: app warn lowers every P02 violation, app off removes them and the allow-entry problem, app block raises additionalDirectories, and a file warn leaves the defaults and is reported lowered", async () => {
    const curl = at('"Bash(curl:*)"');
    const mode = at("bypassPermissions");
    const dirs = at("additionalDirectories");

    const warned = await run(app("warn"));
    expect(p02(warned)).toEqual([
      [curl, "warn"],
      [mode, "warn"],
      [dirs, "warn"],
    ]);
    expect(
      withCode(warned, "POLICY_SETTINGS_INVALID").map((m) => m.level),
      "the unknown allow entry still warns",
    ).toEqual(["warn"]);

    const off = await run(app("off"));
    expect(off.policy, "app off: the policy object stays").toBeDefined();
    expect(p02(off)).toEqual([]);
    expect(withCode(off, "POLICY_P02")).toEqual([]);
    expect(withCode(off, "POLICY_SETTINGS_INVALID"), "app off: no rule reads the allow entries").toEqual([]);

    const raised = await run(app("block"));
    expect(p02(raised)).toEqual([
      [curl, "block"],
      [mode, "block"],
      [dirs, "block"],
    ]);

    const fileWarn = await run(file("warn"));
    expect(p02(fileWarn), "a file can only raise: the defaults stay").toEqual([
      [curl, "block"],
      [mode, "block"],
      [dirs, "warn"],
    ]);
    const ignored = withCode(fileWarn, "POLICY_OVERRIDE_IGNORED");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.text).toContain("policy.rules.P02 (policy-file)");

    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const evaluation = core.evaluatePolicyRules({
      policy: file("warn"),
      agentSetupFileCount: 1,
      agentTools: [],
      repoFiles: ["AGENTS.md", ".claude/settings.json"],
      diff: [],
      configPath: null,
      ignored: [],
      settingsSources: SOURCES,
    });
    expect(evaluation.lowered).toContain("P02");
  });
});
