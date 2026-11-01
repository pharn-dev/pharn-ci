import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-5. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
// too: the AC test is written before the build adds rule P11 and its fixtures, so nothing the build adds may run while
// this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const AGENT_FACTS = {
  pr: {
    author: { login: "claude[bot]", type: "Bot" },
    labels: [],
    commits: [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }],
  },
};

async function run(extra: { mode?: string; rule?: string }): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const base = JSON.parse(fixture("policy-rules/p11/workflows/policy.json"));
  const document = {
    ...base,
    agents: { ...base.agents, ...(extra.mode === undefined ? {} : { protected_paths_mode: extra.mode }) },
    ...(extra.rule === undefined ? {} : { policy: { rules: { P11: extra.rule } } }),
  };
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("policy-rules/p11/workflows/ci.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", ".github/workflows/ci.yml", ".pharn/policy.json", "src/a.ts"],
    policy: { source: "file", version: null, path: ".pharn/policy.json", document },
    agentPrFacts: AGENT_FACTS,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P11: a file: policy always blocks", { timeout: 60_000 }, () => {
  it("AC-5: under a file: policy, protected_paths_mode warn and policy.rules.P11 warn both leave P11 at block and are each named once in POLICY_OVERRIDE_IGNORED", async () => {
    for (const [extra, named] of [
      [{ mode: "warn" }, "agents.protected_paths_mode (policy-file)"],
      [{ rule: "warn" }, "policy.rules.P11 (policy-file)"],
    ] as const) {
      const report = await run(extra);
      expect(
        p11(report).map((v) => [v.severity, v.path]),
        named,
      ).toEqual([["block", ".github/workflows/ci.yml"]]);
      expect(
        withCode(report, "POLICY_P11").map((m) => m.level),
        named,
      ).toEqual(["error"]);
      expect(report.verdict, named).toBe("fail");
      const ignored = withCode(report, "POLICY_OVERRIDE_IGNORED");
      expect(ignored, named).toHaveLength(1);
      expect(ignored[0]?.text, named).toContain(named);
    }
  });
});
