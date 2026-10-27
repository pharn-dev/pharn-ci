import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-13. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
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
/** A person's PR labelled ai-generated whose commits could not be read. */
const FACTS = { pr: { author: { login: "octocat", type: "User" }, labels: ["ai-generated"], commits: null } };
const INCOMPLETE_TEXT =
  "This pull request counts as an agent PR because pharn-ci could not read all of its evidence (`commits-unreadable`), so the org policy's protected paths apply to it.";

async function run(policy: unknown, agentPrFacts: unknown): Promise<Report> {
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
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);
const app = (document: unknown) => ({ source: "app", version: 3, fetchedAt: FETCHED_AT, document });

describe("the AGENT_PR_DETECTION_INCOMPLETE message", { timeout: 60_000 }, () => {
  it("AC-13: incomplete evidence under protected paths gives one warn naming the reason and a P11 violation; no protected paths or no pull request gives none; under a file: policy the messages come POLICY_P11, then the incomplete message, then POLICY_OVERRIDE_IGNORED", async () => {
    const protecting = JSON.parse(fixture("policy-rules/p11/src/policy.json"));

    const first = await run(app(protecting), FACTS);
    expect(withCode(first, "AGENT_PR_DETECTION_INCOMPLETE")).toEqual([
      { level: "warn", code: "AGENT_PR_DETECTION_INCOMPLETE", text: INCOMPLETE_TEXT },
    ]);
    expect(p11(first).map((v) => v.path)).toEqual(["src/a.ts"]);

    const unprotected = await run(app({ version: 1 }), FACTS);
    expect(unprotected.meta?.isAgentPr).toBe(true);
    expect(withCode(unprotected, "AGENT_PR_DETECTION_INCOMPLETE")).toEqual([]);

    const noPr = await run(app(protecting), { pr: null });
    expect(withCode(noPr, "AGENT_PR_DETECTION_INCOMPLETE")).toEqual([]);
    expect(p11(noPr)).toEqual([]);

    const file = await run(
      {
        source: "file",
        version: null,
        path: ".pharn/policy.json",
        document: { ...protecting, agents: { ...protecting.agents, protected_paths_mode: "warn" } },
      },
      FACTS,
    );
    const codes = file.messages.map((m) => m.code);
    const order = ["POLICY_P11", "AGENT_PR_DETECTION_INCOMPLETE", "POLICY_OVERRIDE_IGNORED"];
    for (const code of order)
      expect(
        codes.filter((c) => c === code),
        code,
      ).toHaveLength(1);
    const at = order.map((code) => codes.indexOf(code));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});
