import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-11. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
// too: the AC test is written before the build adds rule P11 and its fixtures, so nothing the build adds may run while
// this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  policy?: { violations: Violation[] };
  meta?: Record<string, unknown>;
};

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
const HUMAN_COMMITS = [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }];
const humanPr = (labels: string[], author = { login: "octocat", type: "User" }) => ({
  pr: { author, labels, commits: HUMAN_COMMITS },
});
const lists = (name: string) => JSON.parse(fixture(`policy-rules/p11/lists/${name}`));
const app = (document: unknown) => ({ source: "app", version: 3, fetchedAt: FETCHED_AT, document });

async function run(policy: unknown, agentPrFacts: unknown, policyFileBase?: unknown): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("policy-rules/p11/src/a.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", ".pharn/policy.json", "src/a.ts"],
    meta: META,
    policy,
    agentPrFacts,
    ...(policyFileBase === undefined ? {} : { policyFileBase }),
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("org policy rule P11: the policy's agent lists add to the defaults", { timeout: 60_000 }, () => {
  it("AC-11: a policy label in another letter case, a policy login, a default label beside a policy list, and a label only the merge-base policy lists each make the PR an agent PR with one P11 violation for src/a.ts", async () => {
    const cases: [string, Report][] = [
      ["policy label Bot-PR", await run(app(lists("labels.json")), humanPr(["Bot-PR"]))],
      [
        "policy login acme-agent",
        await run(app(lists("logins.json")), humanPr([], { login: "acme-agent", type: "User" })),
      ],
      ["default label ai-generated", await run(app(lists("labels.json")), humanPr(["ai-generated"]))],
      [
        "base-only label bot-pr",
        await run(
          { source: "file", version: null, path: ".pharn/policy.json", document: lists("head.json") },
          humanPr(["bot-pr"]),
          { kind: "document", document: lists("base.json") },
        ),
      ],
    ];
    for (const [label, report] of cases) {
      expect(report.meta?.isAgentPr, label).toBe(true);
      expect(
        (report.policy?.violations ?? []).filter((v) => v.id === "P11").map((v) => v.path),
        label,
      ).toEqual(["src/a.ts"]);
    }
  });
});
