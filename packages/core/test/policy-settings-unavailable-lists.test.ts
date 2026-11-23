import { describe, expect, it } from "vitest";
import { check } from "../src/index.js";
import { evaluatePolicyRules } from "../src/policy/rules/evaluate.js";
import { policyRuleMessages } from "../src/policy/rules/messages.js";
import type { PolicyRuleInput } from "../src/policy/rules/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// R1.2 (CORE-37): when the agent settings files cannot be read (no local diff, which a checkout without
// `fetch-depth: 0` gives), POLICY_SETTINGS_INVALID is an error exactly when a rule whose list the policy sets (P02 to
// P06) resolves to block: a demand that cannot be checked is not met. P02, P04 and P05 now fail closed as P03 and P06
// already did; a policy with none of the five lists keeps the warning.

type Message = { level: string; code: string; text: string };

const REASON = "the diff came from the GitHub compare API, so the checkout may not be the pull request head";
const TEXT = `The agent settings files were not read (${REASON}), so P02–P06 did not run. Run the check on a checkout of the pull request head with full history (\`actions/checkout\` with \`fetch-depth: 0\`) so they can be read.`;

const LISTS = {
  P02: { forbidden_permissions: ["Bash(curl:*)"] },
  P03: { required_permissions_deny: ["Bash(rm -rf:*)"] },
  P04: { allowed_mcp_servers: ["github"] },
  P05: { forbidden_mcp_servers: ["evil-server"] },
  P06: { required_hooks: [{ event: "Stop" }] },
} as const;
type Rule = keyof typeof LISTS;
type Severity = "block" | "warn" | "off";

const app = (document: unknown) => ({ source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document });
const file = (document: unknown) => ({ source: "file", version: null, path: "policy/org.json", document });

function settingsMessage(policy: unknown): Message[] {
  const evaluation = evaluatePolicyRules({
    policy,
    agentSetupFileCount: 1,
    agentTools: [],
    repoFiles: [".claude/settings.json"],
    diff: [],
    configPath: null,
    ignored: [],
    settingsSources: { unavailable: REASON },
  } as unknown as PolicyRuleInput);
  return withoutFix(policyRuleMessages(evaluation).filter((m) => m.code === "POLICY_SETTINGS_INVALID")) as Message[];
}

describe("POLICY_SETTINGS_INVALID for unread settings: P02 to P06 fail closed at block", () => {
  // The five lists times severity. An app policy's severity applies as written; a policy file can only raise a rule's
  // default (block), so its warn and off are not applied (`lowered`) and the rule stays at block.
  const rows: [rule: Rule, severity: Severity, appLevel: string, fileLevel: string][] = [];
  for (const rule of Object.keys(LISTS) as Rule[]) {
    rows.push([rule, "block", "error", "error"], [rule, "warn", "warn", "error"], [rule, "off", "warn", "error"]);
  }
  it.each(rows)("%s at %s with its list: app policy %s, policy file %s", (rule, severity, appLevel, fileLevel) => {
    const document = { version: 1, setup: LISTS[rule], policy: { rules: { [rule]: severity } } };
    expect(settingsMessage(app(document))).toEqual([{ level: appLevel, code: "POLICY_SETTINGS_INVALID", text: TEXT }]);
    expect(settingsMessage(file(document))).toEqual([
      { level: fileLevel, code: "POLICY_SETTINGS_INVALID", text: TEXT },
    ]);
  });

  it("each list at its default severity (block) gives an error, with no rules set", () => {
    for (const rule of Object.keys(LISTS) as Rule[]) {
      const document = { version: 1, setup: LISTS[rule] };
      expect(
        settingsMessage(app(document)).map((m) => m.level),
        rule,
      ).toEqual(["error"]);
      expect(
        settingsMessage(file(document)).map((m) => m.level),
        rule,
      ).toEqual(["error"]);
    }
  });

  it("a policy with none of the five lists keeps the warning, even with every rule at block", () => {
    const rules = { P02: "block", P03: "block", P04: "block", P05: "block", P06: "block" };
    for (const document of [
      { version: 1 },
      { version: 1, setup: {} },
      { version: 1, setup: { forbidden_permissions: [], allowed_mcp_servers: [] } },
      { version: 1, policy: { rules } },
    ]) {
      expect(settingsMessage(app(document))).toEqual([{ level: "warn", code: "POLICY_SETTINGS_INVALID", text: TEXT }]);
      expect(settingsMessage(file(document))).toEqual([{ level: "warn", code: "POLICY_SETTINGS_INVALID", text: TEXT }]);
    }
  });

  it("an app policy that turns the listed rules down keeps the warning only when every listed rule is below block", () => {
    const setup = { ...LISTS.P02, ...LISTS.P05 };
    const level = (rules: Record<string, Severity>) =>
      settingsMessage(app({ version: 1, setup, policy: { rules } })).map((m) => m.level);
    expect(level({ P02: "warn", P05: "off" })).toEqual(["warn"]);
    expect(level({ P02: "warn" })).toEqual(["error"]);
    expect(level({ P05: "off" })).toEqual(["error"]);
  });

  it("check(): a blocking forbidden_permissions list with unavailable settings fails the run and says how to fix it, naming no file content", () => {
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["AGENTS.md", "src/a.ts", ".claude/settings.json"],
      policy: app(JSON.parse(fixture("policy-settings/p02/violates-forbidden-allow/policy.json"))),
      policySettingsSources: { unavailable: REASON },
    } as never);
    expectValidReport(report);
    const invalid = withoutFix(report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID"));
    expect(invalid).toEqual([{ level: "error", code: "POLICY_SETTINGS_INVALID", text: TEXT }]);
    expect(report.verdict).toBe("fail");
    expect(TEXT).toContain("fetch-depth: 0");
    // No P02–P06 violation: nothing was read, so nothing is claimed about the files.
    expect((report.policy?.violations ?? []).filter((v) => /^P0[2-6]$/.test(v.id))).toEqual([]);
  });
});
