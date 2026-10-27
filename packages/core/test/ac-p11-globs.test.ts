import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-2. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
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
    diff: { text: fixture(`policy-rules/p11/globs/${diffName}`) },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: JSON.parse(fixture("policy-rules/p11/globs/policy.json")),
    },
    agentPrFacts: AGENT_FACTS,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P11: glob matching", { timeout: 60_000 }, () => {
  it("AC-2: near misses and a nested package.json match nothing; a deep lock, a root lock and the root package.json each give one P11 violation at the touched path", async () => {
    const document = JSON.parse(fixture("policy-rules/p11/globs/policy.json"));
    expect(document.agents.protected_paths).toEqual([
      ".github/workflows/**",
      "migrations/**",
      "**/*.lock",
      "package.json",
    ]);

    for (const name of ["near-miss.diff", "sub-package-json.diff"]) {
      const report = await run(name);
      expect(p11(report), name).toEqual([]);
      expect(withCode(report, "POLICY_P11"), name).toEqual([]);
    }

    for (const [name, path] of [
      ["deep-lock.diff", "a/b/c.lock"],
      ["root-lock.diff", "c.lock"],
      ["package-json.diff", "package.json"],
    ] as const) {
      const violations = p11(await run(name));
      expect(
        violations.map((v) => v.path),
        name,
      ).toEqual([path]);
      expect(violations[0]?.detail, name).toBe("agent PR changes a protected path");
    }
  });
});
