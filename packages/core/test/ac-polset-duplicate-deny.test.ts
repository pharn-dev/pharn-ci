import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-15. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

describe("a repeated deny key: the last one counts", { timeout: 60_000 }, () => {
  it("AC-15: a required rule only in the first of two deny keys is a P03 block, and the second key is a duplicate-key problem at its line", async () => {
    const lines = [
      "{",
      '  "permissions": {',
      '    "deny": ["Bash(rm -rf:*)"],',
      '    "deny": ["Read(.env)"]',
      "  }",
      "}",
    ];
    const secondDeny = 4;
    expect(lines[secondDeny - 1]).toContain('"deny": ["Read(.env)"]');

    const { check } = await import("@pharn-ci/core");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("diff/empty.diff") },
      repoRoot: REPO_ROOT,
      threshold: null,
      repoFiles: ["AGENTS.md", "src/a.ts", ".claude/settings.json"],
      policy: {
        source: "file",
        version: null,
        path: "policy/org.json",
        document: { version: 1, setup: { required_permissions_deny: ["Bash(rm -rf:*)"] } },
      },
      policySettingsSources: { files: [{ path: ".claude/settings.json", text: `${lines.join("\n")}\n` }], dropped: [] },
    } as never) as unknown as Report;
    expectValidReport(report);

    expect((report.policy?.violations ?? []).filter((v) => v.id === "P03")).toEqual([
      {
        id: "P03",
        severity: "block",
        path: ".claude/settings.json",
        line: null,
        detail: "required deny rule Bash(rm -rf:*) is missing",
      },
    ]);
    expect(report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID")).toEqual([
      {
        level: "warn",
        code: "POLICY_SETTINGS_INVALID",
        text: `P02–P06 could not fully use these agent settings files: \`.claude/settings.json\` line ${secondDeny} (\`duplicate-key\`). Claude Code skips an unparseable file or entry; pharn-ci never guesses what it meant, and a file it could not read counts against the policy.`,
      },
    ]);
  });
});
