import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-3. check() is loaded inside the test body and fixtures/policy-rules/ is read there
// too: the AC test is written before the build adds the rules and the fixtures, so nothing the build adds may run
// while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

async function run(extra: Record<string, unknown>): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: fixture("policy-rules/p01-violates/files.txt").trim().split("\n"),
    requireAgentSetup: true,
    expectAgentSetup: ["cursor"],
    ...extra,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("org policy rule P01: requirements from inputs only", { timeout: 60_000 }, () => {
  it("AC-3: a policy document with no setup key adds no P01 violation, and the messages equal the no-policy run's", async () => {
    const withPolicy = await run({
      policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } },
    });
    const without = await run({});

    expect(withPolicy.policy).toBeDefined();
    expect(withPolicy.policy?.violations.filter((v) => v.id === "P01")).toEqual([]);
    // The input requirements still give today's messages, exactly.
    expect(without.messages.map((m) => m.code)).toContain("NO_AGENT_SETUP_FILES");
    expect(withPolicy.messages).toEqual(without.messages);
  });
});
