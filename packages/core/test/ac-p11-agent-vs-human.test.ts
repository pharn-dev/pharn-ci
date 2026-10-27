import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-1. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
// too: the AC test is written before the build adds rule P11 and its fixtures, so nothing the build adds may run while
// this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const human = (message: string) => ({ authorLogin: "octocat", committerLogin: "octocat", message });
const AGENT_FACTS = {
  pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [human("Fix the parser\n")] },
};
const HUMAN_FACTS = {
  pr: { author: { login: "octocat", type: "User" }, labels: [], commits: [human("Fix the parser\n")] },
};

async function run(agentPrFacts: unknown): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("policy-rules/p11/workflows/ci.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", ".github/workflows/ci.yml", "src/a.ts"],
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: JSON.parse(fixture("policy-rules/p11/workflows/policy.json")),
    },
    agentPrFacts,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P11: an agent PR versus a person's PR", { timeout: 60_000 }, () => {
  it("AC-1: an agent PR changing a protected workflow gets one P11 block violation, one POLICY_P11 error and a failing verdict; the same change by a person gets no P11 finding and no incomplete message", async () => {
    const document = JSON.parse(fixture("policy-rules/p11/workflows/policy.json"));
    expect(document.agents.protected_paths).toEqual([".github/workflows/**"]);

    const agent = await run(AGENT_FACTS);
    expect(p11(agent)).toEqual([
      {
        id: "P11",
        severity: "block",
        path: ".github/workflows/ci.yml",
        line: null,
        detail: "agent PR changes a protected path",
      },
    ]);
    const messages = withCode(agent, "POLICY_P11");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(agent.verdict).toBe("fail");

    const person = await run(HUMAN_FACTS);
    expect(p11(person)).toEqual([]);
    expect(withCode(person, "POLICY_P11")).toEqual([]);
    expect(withCode(person, "AGENT_PR_DETECTION_INCOMPLETE")).toEqual([]);
  });
});
