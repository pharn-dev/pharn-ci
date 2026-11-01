import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-8. check() and evaluatePolicyRules() are loaded inside the test body and
// fixtures/policy-rules/p11/ is read there too: the AC test is written before the build adds rule P11 and its
// fixtures, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  policy?: { violations: Violation[] };
  meta?: Record<string, unknown>;
};
type Evaluation = { violations: Violation[]; omitted: Record<string, number>; lowered: string[]; ignored?: unknown };

interface Core {
  check(input: unknown): Report;
  evaluatePolicyRules(input: unknown): Evaluation;
  parseUnifiedDiff(text: string): unknown[];
}

const REPO_ROOT = "/home/runner/work/demo/demo";
const FETCHED_AT = "2026-10-26T12:00:00.000Z";
const META = {
  event: "pull_request",
  repository: "pharn-dev/pharn-ci",
  repositoryId: 123,
  prNumber: 68,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  upload: { status: "skipped" },
};
const AGENT_FACTS = {
  pr: {
    author: { login: "claude[bot]", type: "Bot" },
    labels: [],
    commits: [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }],
  },
};
const app = (document: unknown) => ({ source: "app", version: 3, fetchedAt: FETCHED_AT, document });

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P11: when it is not in effect", { timeout: 60_000 }, () => {
  it("AC-8: empty protected_paths, no agents section, no policy and no agentPrFacts give no P11 finding and no message; meta gains no isAgentPr without facts; evaluatePolicyRules with no agent fields returns no P11 and an empty ignored list", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const diffText = fixture("policy-rules/p11/src/a.diff");
    const protecting = JSON.parse(fixture("policy-rules/p11/src/policy.json"));
    expect(protecting.agents.protected_paths).toEqual(["src/**"]);

    const run = (extra: Record<string, unknown>) => {
      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: diffText },
        repoRoot: REPO_ROOT,
        threshold: null,
        repoFiles: ["AGENTS.md", "src/a.ts"],
        ...extra,
      });
      expectValidReport(report);
      return report;
    };

    const cases: [string, Report][] = [
      [
        "empty protected_paths",
        run({ policy: app({ version: 1, agents: { protected_paths: [] } }), agentPrFacts: AGENT_FACTS }),
      ],
      ["no agents section", run({ policy: app({ version: 1 }), agentPrFacts: AGENT_FACTS })],
      ["no policy", run({ agentPrFacts: AGENT_FACTS })],
    ];
    const withoutFacts = run({ policy: app(protecting), meta: META });
    cases.push(["no agentPrFacts", withoutFacts]);
    for (const [label, report] of cases) {
      expect(p11(report), label).toEqual([]);
      expect(withCode(report, "POLICY_P11"), label).toEqual([]);
      expect(withCode(report, "AGENT_PR_DETECTION_INCOMPLETE"), label).toEqual([]);
    }
    expect(withoutFacts.meta).toBeDefined();
    expect(Object.hasOwn(withoutFacts.meta ?? {}, "isAgentPr")).toBe(false);

    const evaluation = core.evaluatePolicyRules({
      policy: app(protecting),
      agentSetupFileCount: 1,
      agentTools: [],
      repoFiles: ["AGENTS.md", "src/a.ts"],
      diff: core.parseUnifiedDiff(diffText),
      configPath: ".pharn/ci.yml",
      ignored: [],
    });
    expect(evaluation.violations.filter((v) => v.id === "P11")).toEqual([]);
    expect(evaluation.ignored).toEqual([]);
  });
});
