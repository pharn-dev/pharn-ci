import { describe, expect, it } from "vitest";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./without-fix.js";

// E3 item 23 (policy settings), AC-14. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

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
const FORBID_ONLY = { forbidden_permissions: ["Bash(curl:*)"] };

async function run(policy: ResolvedPolicy): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ".claude/settings.json"],
    policy,
    policySettingsSources: { unavailable: REASON },
  });
  expectValidReport(report);
  return report;
}

const app = (document: PolicyDocument): ResolvedPolicy => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document,
});

describe("POLICY_SETTINGS_INVALID: the files were not read", { timeout: 60_000 }, () => {
  it("AC-14: unavailable sources give no P02–P06 violation, one message naming the reason (warn; error for a required app policy or a rule P02–P06 whose list the policy sets at block), and P09 keeps item 22's warn", async () => {
    // R1.2 (CORE-37): a forbidden_permissions list with P02 at block is a demand too, so FORBID_ONLY and SETUP (which
    // holds it) are now an error when the files were not read; these rows said warn, which let a shallow checkout pass
    // a blocking P02 unchecked. The rows that turn P06 down keep their point with P02 turned down as well. A policy
    // with no list keeps the warn (policy-settings-unavailable-lists.test.ts; it has no P09 row to give here).
    const cases: [label: string, policy: ResolvedPolicy, level: string][] = [
      [
        "file policy",
        { source: "file", version: null, path: "policy/org.json", document: { version: 1, setup: FORBID_ONLY } },
        "error",
      ],
      ["app policy", app({ version: 1, setup: FORBID_ONLY }), "error"],
      [
        "app policy with P02 at warn",
        app({ version: 1, setup: FORBID_ONLY, policy: { rules: { P02: "warn" } } }),
        "warn",
      ],
      ["required app policy", app({ version: 1, setup: FORBID_ONLY, policy: { required: true } }), "error"],
      // A required deny rule or hook that cannot be checked is not met: an error even when the policy is not required.
      ["app policy with required_hooks", app({ version: 1, setup: SETUP }), "error"],
      [
        "file policy with required_hooks",
        { source: "file", version: null, path: "policy/org.json", document: { version: 1, setup: SETUP } },
        "error",
      ],
      [
        "app policy with required_permissions_deny",
        app({ version: 1, setup: { required_permissions_deny: ["Bash(rm:*)"] } }),
        "error",
      ],
      // The demand counts only at block: an app policy that turns P06 off or down to warn keeps the warn, once the
      // forbidden_permissions list SETUP also holds is turned down too (P02 at block is a demand of its own).
      [
        "app policy with P06 off",
        app({ version: 1, setup: SETUP, policy: { rules: { P02: "warn", P06: "off" } } }),
        "warn",
      ],
      [
        "app policy with P06 at warn",
        app({ version: 1, setup: SETUP, policy: { rules: { P02: "warn", P06: "warn" } } }),
        "warn",
      ],
      [
        "app policy with P06 off and P02 at block",
        app({ version: 1, setup: SETUP, policy: { rules: { P06: "off" } } }),
        "error",
      ],
    ];
    for (const [label, policy, level] of cases) {
      const report = await run(policy);
      const violations = report.policy?.violations ?? [];
      expect(
        violations.filter((v) => /^P0[2-6]$/.test(v.id)),
        `${label}: no P02–P06 violation`,
      ).toEqual([]);
      // fix-hints (H6): every message now carries a `fix`; the pinned literal is unchanged, so it is read without it.
      const invalid = withoutFix(report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID"));
      expect(invalid, label).toEqual([
        {
          level,
          code: "POLICY_SETTINGS_INVALID",
          // R1.2 (CORE-37): the message now says how to make the files readable.
          text: `The agent settings files were not read (${REASON}), so P02–P06 did not run. Run the check on a checkout of the pull request head with full history (\`actions/checkout\` with \`fetch-depth: 0\`) so they can be read.`,
        },
      ]);
      if (level === "error") expect(report.verdict, `${label}: an error message fails the verdict`).toBe("fail");
      expect(
        withoutFix(violations.filter((v) => v.id === "P09")),
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
