import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-7. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
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
const POLICY_PATH = ".pharn/policy.json";
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
const human = (message: string) => ({ authorLogin: "octocat", committerLogin: "octocat", message });
const AGENT_FACTS = {
  pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [human("Fix the parser\n")] },
};
const HUMAN_FACTS = {
  pr: { author: { login: "octocat", type: "User" }, labels: [], commits: [human("Fix the parser\n")] },
};
const BASE_UNREADABLE_SENTENCE =
  "This agent pull request edits the policy file, and its version at the merge base could not be read, so the paths that version protects could not be checked.";

async function run(agentPrFacts: unknown, policyFileBase: unknown, diffName: string): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture(`policy-rules/p11/edited-file/${diffName}`) },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", POLICY_PATH, "migrations/002.sql", "src/a.ts"],
    meta: META,
    policy: {
      source: "file",
      version: null,
      path: POLICY_PATH,
      document: JSON.parse(fixture("policy-rules/p11/edited-file/head.json")),
    },
    agentPrFacts,
    policyFileBase,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P11: a file: policy the PR edits is read at the merge base", { timeout: 60_000 }, () => {
  it("AC-7: the base document's globs apply to an agent PR; an unreadable base of an edited policy file makes a person's PR an agent PR with a path-less P11 and policy-lists-unreadable; an absent base, or an unedited file, does not", async () => {
    const head = JSON.parse(fixture("policy-rules/p11/edited-file/head.json"));
    const baseDocument = JSON.parse(fixture("policy-rules/p11/edited-file/base.json"));
    expect(head.agents.protected_paths).toEqual(["src/**"]);
    expect(baseDocument.agents.protected_paths).toContain("migrations/**");

    // An agent PR with the base given as a document: the base's migrations/** applies.
    const union = await run(AGENT_FACTS, { kind: "document", document: baseDocument }, "edit.diff");
    expect(p11(union).map((v) => v.path)).toContain("migrations/002.sql");

    // A person's PR, the base unreadable: fail closed.
    const unreadable = await run(HUMAN_FACTS, { kind: "unreadable" }, "edit.diff");
    expect(unreadable.meta?.isAgentPr).toBe(true);
    expect(p11(unreadable)).toContainEqual({
      id: "P11",
      severity: "block",
      path: null,
      line: null,
      detail: "policy file edited and unreadable at the merge base; protected paths could not be checked",
    });
    const p11Messages = withCode(unreadable, "POLICY_P11");
    expect(p11Messages).toHaveLength(1);
    expect(p11Messages[0]?.text).toContain(BASE_UNREADABLE_SENTENCE);
    const incomplete = withCode(unreadable, "AGENT_PR_DETECTION_INCOMPLETE");
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]?.level).toBe("warn");
    expect(incomplete[0]?.text).toContain("policy-lists-unreadable");

    // A person's PR, the base absent (the PR adds the file); and the base unreadable but the file not edited.
    for (const [base, diffName, label] of [
      [{ kind: "absent" }, "edit.diff", "absent base"],
      [{ kind: "unreadable" }, "no-edit.diff", "unreadable base, file not edited"],
    ] as const) {
      const report = await run(HUMAN_FACTS, base, diffName);
      expect(report.meta?.isAgentPr, label).toBe(false);
      expect(p11(report), label).toEqual([]);
      expect(withCode(report, "AGENT_PR_DETECTION_INCOMPLETE"), label).toEqual([]);
    }
  });
});
