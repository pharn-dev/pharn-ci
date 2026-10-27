import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-14. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const REASON = "the checkout is not the pull request head";
const DIFF = [
  "diff --git a/.claude/settings.json b/.claude/settings.json",
  "index 1111111..2222222 100644",
  "--- a/.claude/settings.json",
  "+++ b/.claude/settings.json",
  "@@ -1,3 +1,3 @@",
  " {",
  '-  "theme": "light"',
  '+  "theme": "dark"',
  " }",
  "",
].join("\n");
const SETUP = { forbidden_permissions: ["Bash(curl:*)"], required_hooks: [{ event: "Stop" }] };

async function run(policy: unknown): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ".claude/settings.json"],
    policy,
    policySettingsSources: { unavailable: REASON },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const app = (document: unknown) => ({ source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document });

describe("POLICY_SETTINGS_INVALID: the files were not read", { timeout: 60_000 }, () => {
  it("AC-14: unavailable sources give no P02–P06 violation, one message naming the reason (warn, error for a required app policy), and P09 keeps item 22's warn", async () => {
    const cases: [label: string, policy: unknown, level: string][] = [
      [
        "file policy",
        { source: "file", version: null, path: "policy/org.json", document: { version: 1, setup: SETUP } },
        "warn",
      ],
      ["app policy", app({ version: 1, setup: SETUP }), "warn"],
      ["required app policy", app({ version: 1, setup: SETUP, policy: { required: true } }), "error"],
    ];
    for (const [label, policy, level] of cases) {
      const report = await run(policy);
      const violations = report.policy?.violations ?? [];
      expect(
        violations.filter((v) => /^P0[2-6]$/.test(v.id)),
        `${label}: no P02–P06 violation`,
      ).toEqual([]);
      const invalid = report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID");
      expect(invalid, label).toEqual([
        {
          level,
          code: "POLICY_SETTINGS_INVALID",
          text: `The agent settings files were not read (${REASON}), so P02–P06 did not run.`,
        },
      ]);
      expect(
        violations.filter((v) => v.id === "P09"),
        `${label}: P09 class 4 keeps item 22's warn`,
      ).toEqual([
        {
          id: "P09",
          severity: "warn",
          path: ".claude/settings.json",
          line: null,
          detail: "this change edits a file the policy checks; its direction is not judged yet",
        },
      ]);
    }
  });
});
