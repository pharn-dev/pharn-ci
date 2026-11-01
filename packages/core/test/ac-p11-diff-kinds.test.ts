import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-3. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
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

async function run(diffName: string): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture(`policy-rules/p11/kinds/${diffName}`) },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: JSON.parse(fixture("policy-rules/p11/kinds/policy.json")),
    },
    agentPrFacts: AGENT_FACTS,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");

describe("org policy rule P11: renames, deletions, mode-only and binary changes", { timeout: 60_000 }, () => {
  it("AC-3: a rename out names the old path, a rename in the head path, and a deletion, a mode-only change and a binary change each name the touched path, one violation each", async () => {
    const cases = [
      ["rename-out.diff", "migrations/001.sql"],
      ["rename-in.diff", "migrations/002.sql"],
      ["delete.diff", "migrations/003.sql"],
      ["mode-only.diff", "migrations/004.sql"],
      ["binary.diff", "migrations/005.bin"],
    ] as const;
    for (const [name, path] of cases) {
      const violations = p11(await run(name));
      expect(violations, name).toEqual([
        { id: "P11", severity: "block", path, line: null, detail: "agent PR changes a protected path" },
      ]);
    }
  });
});
