import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-5. check() is loaded inside the test body and fixtures/policy-rules/ is read there
// too: the AC test is written before the build adds the rules and the fixtures, so nothing the build adds may run
// while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

async function run(filesFixture: string): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: fixture(filesFixture).trim().split("\n"),
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: JSON.parse(fixture("policy-rules/p08-violates/policy.json")),
    },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("org policy rule P08: forbidden file tracked", { timeout: 60_000 }, () => {
  it("AC-5: a tracked CLAUDE.local.md matching setup.forbidden_files gives a P08 block violation, a POLICY_P08 error naming it and a failing verdict; untracked gives none", async () => {
    const report = await run("policy-rules/p08-violates/files.txt");
    expect(report.policy?.violations.filter((v) => v.id === "P08")).toEqual([
      {
        id: "P08",
        severity: "block",
        path: "CLAUDE.local.md",
        line: null,
        detail: "tracked file matches forbidden pattern CLAUDE.local.md",
      },
    ]);
    const messages = report.messages.filter((m) => m.code === "POLICY_P08");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(messages[0]?.text).toContain(
      "This repository tracks 1 file that matches a forbidden file pattern of the org policy: ",
    );
    expect(messages[0]?.text).toContain("CLAUDE.local.md");
    expect(report.verdict).toBe("fail");

    const complies = await run("policy-rules/p08-complies/files.txt");
    expect(complies.policy).toBeDefined();
    expect(complies.policy?.violations.filter((v) => v.id === "P08")).toEqual([]);
    expect(complies.messages.filter((m) => m.code === "POLICY_P08")).toEqual([]);
  });
});
