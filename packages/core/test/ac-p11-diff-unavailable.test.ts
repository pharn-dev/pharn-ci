import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-6. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
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
const SENTENCE =
  "This agent pull request could not be checked against the paths the org policy protects, because the diff is unavailable.";

async function run(agentPrFacts: unknown): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { unavailable: "could not get the diff for base...head" },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: JSON.parse(fixture("policy-rules/p11/src/policy.json")),
    },
    agentPrFacts,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P11: a missing diff fails closed", { timeout: 60_000 }, () => {
  it("AC-6: an agent PR with an unavailable diff gets one path-less P11 violation and the diff-unavailable sentence followed by the evidence sentence; a person's PR gets nothing", async () => {
    const agent = await run(AGENT_FACTS);
    expect(p11(agent)).toEqual([
      {
        id: "P11",
        severity: "block",
        path: null,
        line: null,
        detail: "diff unavailable; protected paths could not be checked",
      },
    ]);
    const messages = withCode(agent, "POLICY_P11");
    expect(messages).toHaveLength(1);
    const text = messages[0]?.text ?? "";
    expect(text.startsWith(`${SENTENCE} It counts as an agent PR by: `), text).toBe(true);
    expect(text.endsWith("."), text).toBe(true);

    const person = await run(HUMAN_FACTS);
    expect(p11(person)).toEqual([]);
    expect(withCode(person, "POLICY_P11")).toEqual([]);
  });
});
